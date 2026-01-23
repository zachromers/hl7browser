// HL7 Browser - Popup Script

document.addEventListener('DOMContentLoaded', function() {
  const standardRadio = document.querySelector('input[value="standard"]');
  const collapsedRadio = document.querySelector('input[value="collapsed"]');
  const hideEmptyCheckbox = document.getElementById('hideEmptyFields');
  const messagesPerBatchSelect = document.getElementById('messagesPerBatch');
  const extensionPausedCheckbox = document.getElementById('extensionPaused');
  const pauseSection = document.querySelector('.pause-section');
  const applyBtn = document.getElementById('applyBtn');
  const status = document.getElementById('status');

  // Load current settings
  chrome.storage.sync.get(['viewMode', 'hideEmptyFields', 'messagesPerBatch', 'extensionPaused'], function(result) {
    const currentMode = result.viewMode || 'collapsed';
    if (currentMode === 'standard') {
      standardRadio.checked = true;
    } else {
      collapsedRadio.checked = true;
    }
    hideEmptyCheckbox.checked = result.hideEmptyFields || false;
    messagesPerBatchSelect.value = result.messagesPerBatch || '20';
    extensionPausedCheckbox.checked = result.extensionPaused || false;
    updatePauseVisualState();

    // Update visual selected state after loading from storage
    updateSelectedState();
  });

  // Update visual state for pause toggle
  function updatePauseVisualState() {
    if (extensionPausedCheckbox.checked) {
      pauseSection.classList.add('paused');
    } else {
      pauseSection.classList.remove('paused');
    }
  }

  // Handle pause toggle change - takes effect immediately
  extensionPausedCheckbox.addEventListener('change', function() {
    const isPaused = extensionPausedCheckbox.checked;
    updatePauseVisualState();

    // Save the setting
    chrome.storage.sync.set({ extensionPaused: isPaused }, function() {
      // Send message to content script
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs[0] && tabs[0].url && tabs[0].url.startsWith('file://')) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: isPaused ? 'pause' : 'resume'
          }, function(response) {
            if (chrome.runtime.lastError) {
              // Content script might not be loaded, reload the page
              chrome.tabs.reload(tabs[0].id);
            } else {
              status.textContent = isPaused ? 'Extension paused' : 'Extension resumed';
              status.className = 'status success';
              setTimeout(function() {
                status.textContent = '';
                status.className = 'status';
              }, 2000);
            }
          });
        }
      });
    });
  });

  // Update visual selected state based on checked radio
  function updateSelectedState() {
    document.querySelectorAll('.view-option').forEach(function(opt) {
      opt.classList.remove('selected');
    });
    const checkedRadio = document.querySelector('input[name="viewMode"]:checked');
    if (checkedRadio) {
      checkedRadio.closest('.view-option').classList.add('selected');
    }
  }

  // Apply button click handler
  applyBtn.addEventListener('click', function() {
    const selectedMode = document.querySelector('input[name="viewMode"]:checked').value;
    const hideEmpty = hideEmptyCheckbox.checked;
    const messagesPerBatch = messagesPerBatchSelect.value;

    // Save the settings
    chrome.storage.sync.set({ viewMode: selectedMode, hideEmptyFields: hideEmpty, messagesPerBatch: messagesPerBatch }, function() {
      status.textContent = 'Settings saved! Reloading...';
      status.className = 'status success';

      // Reload the active tab if it's a file URL
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (tabs[0] && tabs[0].url) {
          const url = tabs[0].url.toLowerCase();
          // Reload if it's a file URL (hl7 or txt files)
          if (url.startsWith('file://')) {
            chrome.tabs.reload(tabs[0].id, {}, function() {
              // Close the popup after reload is initiated
              setTimeout(function() {
                window.close();
              }, 500);
            });
          } else {
            // Not a file URL, just show success
            setTimeout(function() {
              status.textContent = 'Settings saved!';
            }, 500);
            setTimeout(function() {
              status.textContent = '';
              status.className = 'status';
            }, 2000);
          }
        }
      });
    });
  });

  // Visual feedback when selecting an option
  document.querySelectorAll('input[name="viewMode"]').forEach(function(radio) {
    radio.addEventListener('change', updateSelectedState);
  });
});
