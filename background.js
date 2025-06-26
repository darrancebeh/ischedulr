// Functions like getAuthToken() and createCalendarEvent() from the previous guide are UNCHANGED.
// We only need to change the function that formats the data.

// NEW function to format the event for Google Calendar.
// This is much simpler because we have the exact date and time.
function formatEventForGoogle(course) {
  // --- Time and Date Parsing ---
  const [startTimeStr, endTimeStr] = course.time.split(' - '); // e.g., "08:00", "09:00"

  // We combine the date string and time string to create a full date object
  // Example: "02-Sep-2024" and "08:00" becomes a valid Date object
  const startDateTime = new Date(`${course.date} ${startTimeStr}`);
  const endDateTime = new Date(`${course.date} ${endTimeStr}`);

  // Construct the event object for the Google Calendar API
  const event = {
    'summary': `${course.subject} (${course.grouping})`,
    'location': course.venue,
    'description': `Lecturer: ${course.lecturer}`,
    'start': {
      'dateTime': startDateTime.toISOString(), // Converts the date to the format Google needs
      'timeZone': 'Asia/Kuala_Lumpur', // IMPORTANT: Change this to your university's timezone!
                                       // Find your timezone here: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
    },
    'end': {
      'dateTime': endDateTime.toISOString(),
      'timeZone': 'Asia/Kuala_Lumpur', // Use the same timezone here
    },
    // We don't need a 'recurrence' field anymore!
  };
  return event;
}


// --- THE REST OF THE FILE IS THE SAME AS THE PREVIOUS GUIDE ---

// 1. A function to get the Google Auth Token
function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
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
  return responseData;
}

// 3. Listen for the message from our popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "migrateData") {
    console.log("Background: Received timetable data:", request.data);
    
    // For debugging: just log the data instead of migrating
    try {
      console.log("Background: Processing courses...");
      console.log("Background: Found", request.data.length, "courses:");
      
      for (const course of request.data) {
        console.log("Background: Course:", course);
        console.log("Background: Course Details:", {
          subject: course.subject,
          grouping: course.grouping,
          venue: course.venue,
          lecturer: course.lecturer,
          date: course.date,
          time: course.time
        });
      }
      console.log("Background: All courses processed successfully");
      sendResponse({ success: true, message: "Data logged to console successfully" });
    } catch (error) {
      console.error("Background: Processing failed:", error);
      sendResponse({ success: false, error: error.message });
    }
    
    return true; // Indicates you will send a response asynchronously
  }
});