// Functions like getAuthToken() and createCalendarEvent() from the previous guide are UNCHANGED.
// We only need to change the function that formats the data.

// NEW function to format the event for Google Calendar.
// This is much simpler because we have the exact date and time.
function formatEventForGoogle(course, eventDate) {
  // --- Time and Date Parsing ---
  const [startTimeStr, endTimeStr] = course.time.split(' - '); // e.g., "02:00 PM", "04:00 PM"

  // Helper function to convert 12-hour AM/PM time to 24-hour format
  const convertTo24Hour = (timeStr) => {
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    if (modifier === 'PM' && hours < 12) {
      hours += 12;
    }
    if (modifier === 'AM' && hours === 12) { // Handle midnight case (12:00 AM)
      hours = 0;
    }
    return { hours, minutes };
  };

  const { hours: startHour, minutes: startMinute } = convertTo24Hour(startTimeStr);
  const { hours: endHour, minutes: endMinute } = convertTo24Hour(endTimeStr);

  // Create the start date object
  const startDateTime = new Date(eventDate);
  startDateTime.setHours(startHour, startMinute, 0, 0); // Set hours, minutes, seconds, and milliseconds

  // Create the end date object based on the start date
  const endDateTime = new Date(startDateTime);
  endDateTime.setHours(endHour, endMinute, 0, 0);

  // Handle cases where the class spans across midnight (unlikely for timetables, but good practice)
  if (endDateTime <= startDateTime) {
    endDateTime.setDate(endDateTime.getDate() + 1);
  }

  // Construct the event object for the Google Calendar API
  const event = {
    'summary': `${course.subject} (${course.grouping})`,
    'location': course.venue,
    'description': `Lecturer: ${course.lecturer}`,
    'start': {
      'dateTime': startDateTime.toISOString(),
      'timeZone': 'Asia/Kuala_Lumpur',
    },
    'end': {
      'dateTime': endDateTime.toISOString(),
      'timeZone': 'Asia/Kuala_Lumpur',
    },
  };
  return event;
}

// NEW function to create an all-day event for weekly reminders
function createWeeklyReminderEvent(title, date) {
  const event = {
    'summary': title,
    'start': {
      'date': date.toISOString().split('T')[0], // Format as YYYY-MM-DD for all-day events
      'timeZone': 'Asia/Kuala_Lumpur',
    },
    'end': {
      'date': date.toISOString().split('T')[0],
      'timeZone': 'Asia/Kuala_Lumpur',
    },
    'transparency': 'transparent' // So it doesn't show as "busy"
  };
  return event;
}

// 1. A function to get the Google Auth Token for a specific account
function getAuthToken(accountId) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true, account: { id: accountId } }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

// 2. The main function that handles the API call
async function createCalendarEvent(token, eventData) {
  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventData)
  });
  // Added error logging for better debugging
  const responseData = await response.json();
  if (responseData.error) {
      console.error('Google API Error:', responseData.error);
  }
  return responseData; // This will contain the event object, including the id
}

// NEW function to delete an event from Google Calendar
async function deleteCalendarEvent(token, eventId) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
    }
  });

  // If the response is empty, it means the deletion was successful (status 204)
  if (response.status === 204) {
    return { success: true };
  }

  const responseData = await response.json();
  if (responseData.error) {
    console.error('Google API Error on delete:', responseData.error);
  }
  return responseData;
}

// Main migration logic
async function migrateFullSemester(timetableData, semesterDetails, token, accountId) {
  const createdEventIds = []; // To store the IDs of all created events

  // 1. Calculate the start date of the entire semester
  const checkpoint = new Date(semesterDetails.checkpointDate);
  const dayOfWeekOfCheckpoint = checkpoint.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  
  // Find the Monday of the checkpoint's week
  const startOfWeekOfCheckpoint = new Date(checkpoint);
  const dayOffset = (dayOfWeekOfCheckpoint === 0) ? 6 : dayOfWeekOfCheckpoint - 1; // Adjust for Sunday
  startOfWeekOfCheckpoint.setDate(checkpoint.getDate() - dayOffset);

  // Calculate the Monday of Week 1
  const semesterStartDate = new Date(startOfWeekOfCheckpoint);
  semesterStartDate.setDate(startOfWeekOfCheckpoint.getDate() - (semesterDetails.currentWeek - 1) * 7);

  // 2. Loop through all weeks of the semester
  for (let week = 1; week <= semesterDetails.type; week++) {
    const currentMonday = new Date(semesterStartDate);
    currentMonday.setDate(semesterStartDate.getDate() + (week - 1) * 7);

    // Don't schedule events for past weeks
    if (week < semesterDetails.currentWeek) {
      continue;
    }

    // 3. Handle mid-semester break for long semesters
    let weekOffset = 0;
    if (semesterDetails.type == 14) {
        if (week >= 7) {
            weekOffset = 1; // Account for mid-semester break
        }
        if (week === 7) {
            const breakEvent = createWeeklyReminderEvent("Mid-Semester Break (Week 7)", currentMonday);
            const createdEvent = await createCalendarEvent(token, breakEvent);
            if (createdEvent && createdEvent.id) {
                createdEventIds.push(createdEvent.id);
            }
            continue; // Skip to the next week, no classes during the break
        }
    }

    // 4. Add the "Academic Week X" reminder
    const actualAcademicWeek = week + weekOffset;
    const reminderEvent = createWeeklyReminderEvent(`Academic Week ${actualAcademicWeek}`, currentMonday);
    const createdReminder = await createCalendarEvent(token, reminderEvent);
    if (createdReminder && createdReminder.id) {
        createdEventIds.push(createdReminder.id);
    }

    // 5. Schedule all the classes for the current week
    for (const course of timetableData) {
      const parsedDate = new Date(course.date);
      const courseDayOfWeek = parsedDate.getDay(); // 0=Sun, 1=Mon, ...
      const dayOffset = (courseDayOfWeek === 0) ? 6 : courseDayOfWeek - 1;

      const eventDate = new Date(currentMonday);
      eventDate.setDate(currentMonday.getDate() + dayOffset);

      const eventData = formatEventForGoogle(course, eventDate);
      const createdEvent = await createCalendarEvent(token, eventData);
      if (createdEvent && createdEvent.id) {
        createdEventIds.push(createdEvent.id);
      }
    }
  }
  // After the loop, save the history
  await saveMigrationHistory(createdEventIds, semesterDetails, accountId);
}

// NEW function to save migration history
async function saveMigrationHistory(eventIds, semesterDetails, accountId) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ migrationHistory: [] }, (result) => {
      const history = result.migrationHistory;
      history.push({
        migrationId: `mig-${Date.now()}`,
        date: new Date().toISOString(),
        semesterDetails: semesterDetails,
        eventIds: eventIds,
        accountId: accountId, // Save the account ID with the history
      });
      chrome.storage.local.set({ migrationHistory: history }, () => {
        console.log("Migration history saved.", history);
        resolve();
      });
    });
  });
}

// 3. Listen for the message from our popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "migrateData") {
    console.log("Background: Received data for migration:", request);

    getAuthToken(request.accountId) // Pass the account ID here
      .then(token => {
        return migrateFullSemester(request.data, request.semesterDetails, token, request.accountId);
      })
      .then(() => {
        console.log("Background: Migration completed successfully.");
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error("Background: Migration failed:", error);
        sendResponse({ success: false, error: error.message });
      });

    return true; // To indicate that we will be sending a response asynchronously
  }

  // NEW listener for deleting a migration
  if (request.action === "deleteMigration") {
    console.log("Background: Received request to delete migration:", request.migrationId);

    // First, get the migration from history to find the associated account ID
    chrome.storage.local.get({ migrationHistory: [] }, (result) => {
      const migrationToDelete = result.migrationHistory.find(m => m.migrationId === request.migrationId);

      if (!migrationToDelete || !migrationToDelete.accountId) {
        const errorMsg = "Account ID for this migration was not saved. Cannot undo.";
        console.error("Background: " + errorMsg);
        sendResponse({ success: false, error: errorMsg });
        return;
      }

      // Now, get the token for the correct account
      getAuthToken(migrationToDelete.accountId)
        .then(token => {
          return undoMigration(token, request.migrationId);
        })
        .then(() => {
          console.log("Background: Successfully deleted migration.");
          sendResponse({ success: true });
        })
        .catch(error => {
          console.error("Background: Failed to delete migration:", error);
          sendResponse({ success: false, error: error.message });
        });
    });

    return true; // To indicate that we will be sending a response asynchronously
  }

  // NEW listener for clearing all history
  if (request.action === "clearAllHistory") {
    chrome.storage.local.set({ migrationHistory: [] }, () => {
      console.log("Background: All migration history cleared.");
      sendResponse({ success: true });
    });
    return true;
  }
});

// NEW function to handle the undo logic
async function undoMigration(migrationId) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get({ migrationHistory: [] }, async (result) => {
      const history = result.migrationHistory;
      const migrationToDelete = history.find(item => item.migrationId === migrationId);

      if (!migrationToDelete) {
        return reject(new Error("Migration not found."));
      }

      if (!migrationToDelete.accountId) {
        return reject(new Error("Account ID for this migration was not saved. Cannot undo."));
      }

      try {
        const token = await getAuthToken(migrationToDelete.accountId);
        for (const eventId of migrationToDelete.eventIds) {
          await deleteCalendarEvent(token, eventId);
        }

        // Remove the migration from the history
        const updatedHistory = history.filter(item => item.migrationId !== migrationId);
        chrome.storage.local.set({ migrationHistory: updatedHistory }, () => {
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}