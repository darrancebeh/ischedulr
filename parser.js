/**
 * A helper function to take a string containing HTML and return just the text.
 * @param {string} htmlString The string with HTML tags.
 * @returns {string} The cleaned text.
 */
function cleanHtml(htmlString) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString;
  return tempDiv.textContent || tempDiv.innerText || '';
}

function parseTimetable() {
  console.log("Parser: Starting to parse timetable...");
  console.log("Parser: Current URL:", window.location.href);
  console.log("Parser: Page title:", document.title);
  
  const schedule = [];

  // 1. Select the main table body using its class. This is much more reliable than an XPath.
  const timetableBody = document.querySelector('tbody.ttSlot');
  if (!timetableBody) {
    console.error("Could not find the timetable body with class 'ttSlot'.");
    
    // Let's also check for other possible table structures
    const allTables = document.querySelectorAll('table');
    console.log("Parser: Found", allTables.length, "tables on the page");
    
    const allTbodies = document.querySelectorAll('tbody');
    console.log("Parser: Found", allTbodies.length, "tbody elements");
    
    allTbodies.forEach((tbody, index) => {
      console.log(`Parser: tbody ${index} classes:`, tbody.className);
    });
    
    return [];
  }

  console.log("Parser: Found timetable body with class 'ttSlot'");

  // 2. Get all the day rows (<tr>) within the timetable body.
  const dayRows = timetableBody.querySelectorAll('tr');

  // 3. Loop through each day row.
  dayRows.forEach(row => {
    // 4. Get the date from the row's header (<th>).
    const dateElement = row.querySelector('th span');
    if (!dateElement) return; // Skip if this row doesn't have a date.
    const dateStr = dateElement.innerText.trim(); // e.g., "23 Jun 2025"

    // 5. Get all the class cells (<td>) in that row.
    const classCells = row.querySelectorAll('td');

    // 6. Loop through each class cell.
    classCells.forEach(cell => {
      // 7. Check if the cell is an empty placeholder (which has a 'colspan' attribute).
      if (cell.hasAttribute('colspan')) {
        return; // Skip this empty cell.
      }

      // 8. The data is separated by <br> tags. We can split the cell's content by them.
      const parts = cell.innerHTML.split(/<br\s*\/?>/i);

      // Check if the parts array is valid (has enough elements for a class)
      if (parts.length < 7) {
        return;
      }
      
      // 9. Extract and clean each piece of information.
      const timeStr = cleanHtml(parts[0]).replace('Time :', '').trim();
      const subjectStr = cleanHtml(parts[2]).trim();
      const groupingStr = cleanHtml(parts[4]).replace('Grouping :', '').trim();
      const venueStr = cleanHtml(parts[5]).replace('Venue :', '').trim();
      const lecturerStr = cleanHtml(parts[6]).replace('Lecturer :', '').trim();

      // 10. Assemble the final object for this class instance.
      const classInstance = {
        subject: subjectStr,
        grouping: groupingStr,
        venue: venueStr,
        lecturer: lecturerStr,
        date: dateStr, // The exact date, e.g., "23 Jun 2025"
        time: timeStr, // The time range, e.g., "02:00 PM - 04:00 PM"
      };

      schedule.push(classInstance);
    });
  });

  return schedule;
}

// This listener part remains unchanged. It waits for the command from the popup.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Parser: Received message:", request);
  if (request.action === "parseTimetable") {
    console.log("Parser: Starting timetable parsing...");
    const timetableData = parseTimetable();
    console.log("Parser: Found", timetableData.length, "classes");
    console.log("Parser: Timetable data:", timetableData);
    // Send the parsed data back to the popup
    sendResponse({ data: timetableData });
  }
  return true; // Keep the message channel open for the response
});