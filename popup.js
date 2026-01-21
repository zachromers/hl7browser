// HL7 Browser - Popup Script

document.addEventListener('DOMContentLoaded', function() {
  const standardRadio = document.querySelector('input[value="standard"]');
  const collapsedRadio = document.querySelector('input[value="collapsed"]');
  const applyBtn = document.getElementById('applyBtn');
  const status = document.getElementById('status');

  // Load current setting
  chrome.storage.sync.get(['viewMode'], function(result) {
    const currentMode = result.viewMode || 'standard';
    if (currentMode === 'collapsed') {
      collapsedRadio.checked = true;
    } else {
      standardRadio.checked = true;
    }
  });

  // Apply button click handler
  applyBtn.addEventListener('click', function() {
    const selectedMode = document.querySelector('input[name="viewMode"]:checked').value;

    // Save the setting
    chrome.storage.sync.set({ viewMode: selectedMode }, function() {
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
    radio.addEventListener('change', function() {
      document.querySelectorAll('.view-option').forEach(function(opt) {
        opt.classList.remove('selected');
      });
      this.closest('.view-option').classList.add('selected');
    });

    // Set initial selected state
    if (radio.checked) {
      radio.closest('.view-option').classList.add('selected');
    }
  });
});
