document.getElementById('migrateButton').addEventListener('click', () => {
  const statusDiv = document.getElementById('status');
  const migrateButton = document.getElementById('migrateButton');

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
        let previewMessage = `The extension found ${timetableData.length} classes.\n\nDo you want to add them to your calendar?\n\n--- PREVIEW ---\n`;
        
        // We'll only preview the first 5 classes to keep the alert box from being huge.
        timetableData.slice(0, 5).forEach(course => {
          const startTime = course.time.split(' - ')[0]; // Get just the start time
          previewMessage += `- ${course.date} @ ${startTime}: ${course.subject}\n`;
        });

        if (timetableData.length > 5) {
          previewMessage += `\n...and ${timetableData.length - 5} more.`;
        }

        // 2. Show the confirm dialog box. If the user clicks "OK", this returns true.
        if (window.confirm(previewMessage)) {
          // User clicked OK, so we proceed with the migration.
          statusDiv.textContent = `Approved! Migrating ${timetableData.length} courses...`;
          
          chrome.runtime.sendMessage({ action: "migrateData", data: timetableData }, (bgResponse) => {
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

        // --- NEW CONFIRMATION LOGIC ENDS HERE ---

        } else {
          statusDiv.textContent = 'Could not find a valid timetable on this page.';
          migrateButton.disabled = false;
        }
        });
      }, 500); // Wait 500ms for script to load
    });
  });
});