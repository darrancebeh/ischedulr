document.addEventListener('DOMContentLoaded', () => {
  const historyContainer = document.getElementById('historyContainer');
  const clearHistoryButton = document.getElementById('clearHistory');

  // Function to render the history items
  const renderHistory = (history) => {
    historyContainer.innerHTML = ''; // Clear previous content

    if (!history || history.length === 0) {
      historyContainer.innerHTML = '<p>No migration history found.</p>';
      return;
    }

    // Sort history from newest to oldest
    history.sort((a, b) => new Date(b.date) - new Date(a.date));

    history.forEach(item => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'history-item';

      const migrationDate = new Date(item.date).toLocaleString();
      const semesterType = item.semesterDetails.type === 14 ? 'Long Semester' : 'Short Semester';

      itemDiv.innerHTML = `
        <p><strong>Migration ID:</strong> ${item.migrationId}</p>
        <p><strong>Date:</strong> ${migrationDate}</p>
        <p><strong>Semester:</strong> ${semesterType}, starting from Week ${item.semesterDetails.currentWeek}</p>
        <p><em>(${item.eventIds.length} events created)</em></p>
        <button data-migration-id="${item.migrationId}">Undo Migration</button>
      `;

      historyContainer.appendChild(itemDiv);
    });
  };

  // Load and render the history from storage
  chrome.storage.local.get({ migrationHistory: [] }, (result) => {
    renderHistory(result.migrationHistory);
  });

  // Listen for clicks on the undo buttons
  historyContainer.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && e.target.dataset.migrationId) {
      const migrationId = e.target.dataset.migrationId;
      if (confirm(`Are you sure you want to undo migration ${migrationId}? This will delete all associated calendar events.`)) {
        e.target.textContent = 'Deleting...';
        e.target.disabled = true;

        chrome.runtime.sendMessage({ action: 'deleteMigration', migrationId: migrationId }, (response) => {
          if (response.success) {
            // Refresh the history view
            chrome.storage.local.get({ migrationHistory: [] }, (result) => {
              renderHistory(result.migrationHistory);
            });
          } else {
            alert(`Error deleting migration: ${response.error}`);
            e.target.textContent = 'Undo Migration';
            e.target.disabled = false;
          }
        });
      }
    }
  });

  // Listen for clicks on the clear all history button
  clearHistoryButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all migration history? This action cannot be undone, but it will NOT delete any events from your calendar.')) {
      chrome.runtime.sendMessage({ action: 'clearAllHistory' }, (response) => {
        if (response.success) {
          renderHistory([]); // Clear the view immediately
        } else {
          alert('Failed to clear history.');
        }
      });
    }
  });
});
