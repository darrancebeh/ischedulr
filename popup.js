document.addEventListener('DOMContentLoaded', () => {
  // Set the checkpoint date to today by default
  const checkpointDateInput = document.getElementById('checkpointDate');
  if (checkpointDateInput) {
    checkpointDateInput.valueAsDate = new Date();
  }

  const migrateButton = document.getElementById('migrateButton');
  const statusDiv = document.getElementById('status');
  const signInButton = document.getElementById('signInButton');
  const changeAccountButton = document.getElementById('changeAccountButton');
  const userInfoDiv = document.getElementById('userInfo');
  const userEmailSpan = document.getElementById('userEmail');
  const migrationControls = document.getElementById('migrationControls');
  const previewSection = document.getElementById('preview-section');
  const previewContent = document.getElementById('previewContent');
  const confirmMigrationButton = document.getElementById('confirmMigrationButton');
  const cancelMigrationButton = document.getElementById('cancelMigrationButton');

  let currentAccountId = null;

  // Function to get user info from Google
  async function getUserInfo(token) {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return response.json();
  }

  // Function to update the UI based on sign-in state
  function updateUiForSignIn(account) {
    userInfoDiv.style.display = 'block';
    userEmailSpan.textContent = account.email;
    signInButton.style.display = 'none';
    migrationControls.style.display = 'block';
    statusDiv.textContent = 'Ready to migrate your schedule.';
  }

  // Function to handle the sign-in process
  function signIn(isInteractive) {
    chrome.identity.getAuthToken({ interactive: isInteractive }, async (token) => {
      if (chrome.runtime.lastError) {
        // If the user closes the sign-in window, it's not a fatal error.
        if (chrome.runtime.lastError.message.includes('The user declined') || chrome.runtime.lastError.message.includes('Authorization page could not be loaded')) {
          statusDiv.textContent = 'Sign-in process was cancelled.';
        } else {
          statusDiv.textContent = 'Sign-in failed. Please try again.';
          console.error(chrome.runtime.lastError);
        }
        return;
      }
      if (!token) { // Handle case where token is just not available
        statusDiv.textContent = 'Could not retrieve authentication token.';
        return;
      }

      try {
        const userInfo = await getUserInfo(token);
        if (userInfo && userInfo.id) {
          currentAccountId = userInfo.id;
          updateUiForSignIn(userInfo);
        } else {
          // This case might be hit if the token is invalid
          throw new Error('User info not found in response.');
        }
      } catch (error) {
        console.error("Error fetching user info, possibly stale token:", error);
        // The token is likely invalid or expired. Remove it and try again.
        chrome.identity.removeCachedAuthToken({ token: token }, () => {
          statusDiv.textContent = 'Token was invalid, please try signing in again.';
        });
      }
    });
  }

  // --- Event Listeners ---

  signInButton.addEventListener('click', () => {
    signIn(true); // Interactive sign-in on button click
  });

  changeAccountButton.addEventListener('click', () => {
    chrome.identity.getAuthToken({ interactive: false }, (currentToken) => {
      if (chrome.runtime.lastError) {
        // No token, just try to sign in
        signIn(true);
        return;
      }
      if (currentToken) {
        // Revoke the token to allow for account switching
        const url = `https://accounts.google.com/o/oauth2/revoke?token=${currentToken}`;
        window.fetch(url);

        // Remove the token from the cache
        chrome.identity.removeCachedAuthToken({ token: currentToken }, () => {
          signIn(true); // Prompt for account selection again
        });
      } else {
        // No token was cached, just sign in
        signIn(true);
      }
    });
  });

  migrateButton.addEventListener('click', () => {
    if (!currentAccountId) {
      statusDiv.textContent = 'Please sign in first.';
      return;
    }

    const statusDiv = document.getElementById('status');
    const migrateButton = document.getElementById('migrateButton');

    // Get the new semester details from the form
    const semesterType = document.getElementById('semesterType').value;
    const currentWeek = document.getElementById('currentWeek').value;
    const checkpointDate = document.getElementById('checkpointDate').value;

    migrateButton.disabled = true;
    statusDiv.textContent = 'Reading timetable...';

    // Find the active tab and send a message to our parser.js content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      
      // Check if we're on the right page
      if (!currentTab.url.includes('izone.sunway.edu.my')) {
        statusDiv.textContent = 'Error: Please navigate to the iZone timetable page first.';
        migrateButton.disabled = false;
        return;
      }

      statusDiv.textContent = `Connected to: ${currentTab.url.substring(0, 50)}...`;

      // Try to inject the content script if it's not already loaded
      chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ['parser.js']
      }, (injectionResults) => {
        if (chrome.runtime.lastError) {
          statusDiv.textContent = `Error injecting script: ${chrome.runtime.lastError.message}`;
          migrateButton.disabled = false;
          return;
        }
        
        // Wait a moment for the script to load, then send the message
        setTimeout(() => {
          chrome.tabs.sendMessage(currentTab.id, { action: "parseTimetable" }, (response) => {
            // This function runs when the parser.js sends a response back
            if (chrome.runtime.lastError) {
              statusDiv.textContent = `Error: Could not connect to the page. ${chrome.runtime.lastError.message}. Make sure you are on the iZone timetable page and refresh the page.`;
              migrateButton.disabled = false;
              return;
            }

            // Check if the parser found any data
            if (response && response.data && response.data.length > 0) {
              const timetableData = response.data;

              // --- NEW CONFIRMATION LOGIC STARTS HERE ---

              // 1. Format the data into a human-readable preview message.
              let previewMessage = `The extension found ${timetableData.length} classes for your typical week.\n\nThis schedule will be applied for the rest of the semester based on your inputs (Semester: ${semesterType} weeks, Current Week: ${currentWeek}).\nDisclaimer: The preview above is simplified. Please verify the total class count (${timetableData.length}) before proceeding.\n\n--- PREVIEW OF YOUR WEEKLY SCHEDULE ---\n`;

              const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
              
              // Group courses by day of the week
              const scheduleByDay = {};
              timetableData.forEach(course => {
                  const courseDate = new Date(course.date);
                  const dayIndex = courseDate.getDay();
                  if (!scheduleByDay[dayIndex]) {
                      scheduleByDay[dayIndex] = [];
                  }
                  scheduleByDay[dayIndex].push(course);
              });

              // Sort courses within each day by start time
              for (const dayIndex in scheduleByDay) {
                  scheduleByDay[dayIndex].sort((a, b) => {
                      const timeA = a.time.split(' - ')[0];
                      const timeB = b.time.split(' - ')[0];
                      return timeA.localeCompare(timeB);
                  });
              }

              // Build the preview message, grouped by day
              for (let i = 0; i < 7; i++) { // Loop from Sunday to Saturday to ensure order
                  if (scheduleByDay[i]) {
                      previewMessage += `\n${days[i]}\n`;
                      scheduleByDay[i].forEach(course => {
                          const startTime = course.time.split(' - ')[0];
                          previewMessage += `- ${startTime}: ${course.subject}\n`;
                      });
                  }
              }

              // 2. Show the confirm dialog box. If the user clicks "OK", this returns true.
              if (window.confirm(previewMessage)) {
                // User clicked OK, so we proceed with the migration.
                statusDiv.textContent = `Approved! Migrating ${timetableData.length} courses for the rest of the semester...`;
                
                // Send all the data, including the new semester details, to the background script
                chrome.runtime.sendMessage({
                  action: "migrateData",
                  accountId: currentAccountId, // Pass the account ID
                  data: timetableData,
                  semesterDetails: {
                    type: semesterType,
                    currentWeek: parseInt(currentWeek, 10),
                    checkpointDate: checkpointDate
                  }
                }, (bgResponse) => {
                  if (bgResponse && bgResponse.success) {
                    statusDiv.textContent = 'Success! Your timetable has been migrated.';
                  } else {
                    statusDiv.textContent = 'An error occurred during migration. Check the console.';
                    console.error('Migration Error:', bgResponse.error);
                  }
                  migrateButton.disabled = false;
                });

              } else {
                // User clicked Cancel.
                statusDiv.textContent = 'Migration cancelled by user.';
                migrateButton.disabled = false;
              }

            } else {
              statusDiv.textContent = 'Could not find a valid timetable on this page.';
              migrateButton.disabled = false;
            }
          });
        }, 500); // Wait 500ms for script to load
      });
    });
  });

  // Try a non-interactive sign-in on load
  signIn(false);
});