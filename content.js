// HL7 Browser - Content Script
// Parses HL7 messages and JSON data with interactive viewing

// Expose render helper globally for stats.js to call
var HL7BrowserRender = {};

(function() {
  'use strict';

  // Configuration defaults
  const DEFAULT_MESSAGES_PER_BATCH = 20;

  // Get the raw text content of the page
  const rawContent = document.body.innerText || document.body.textContent;

  // Store original HTML for pause/resume functionality
  const originalHTML = document.body.innerHTML;
  let isExtensionActive = false;

  // Track current page mode ('viewer' or 'stats')
  let currentPageMode = 'viewer';

  // Detect content type
  const contentType = detectContentType(rawContent);

  if (!contentType) {
    return; // Not supported content, don't modify the page
  }

  // Expose the renderHL7IntoContainer function for stats.js
  HL7BrowserRender.renderIntoContainer = function(container, content, viewMode) {
    renderHL7IntoContainer(container, content, viewMode);
  };

  // Listen for pause/resume messages from popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
      if (message.action === 'pause') {
        pauseExtension();
        sendResponse({ success: true });
      } else if (message.action === 'resume') {
        resumeExtension();
        sendResponse({ success: true });
      }
      return true; // Keep message channel open for async response
    });
  }

  /**
   * Pause the extension - restore original content
   */
  function pauseExtension() {
    if (isExtensionActive) {
      document.body.innerHTML = originalHTML;
      isExtensionActive = false;
    }
  }

  /**
   * Resume the extension - re-render with extension behavior
   */
  function resumeExtension() {
    if (!isExtensionActive) {
      renderWithCurrentSettings();
    }
  }

  /**
   * Render content with current settings from storage
   */
  function renderWithCurrentSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.sync.get(['viewMode', 'hideEmptyFields', 'messagesPerBatch'], function(result) {
        const viewMode = result.viewMode || 'collapsed';
        const hideEmptyFields = result.hideEmptyFields || false;
        const messagesPerBatch = parseInt(result.messagesPerBatch) || DEFAULT_MESSAGES_PER_BATCH;

        setupPageStructure();

        if (contentType === 'json') {
          renderJSONContent(rawContent, viewMode, messagesPerBatch);
        } else {
          renderHL7Content(rawContent, viewMode, hideEmptyFields, messagesPerBatch);
        }
        isExtensionActive = true;
      });
    } else {
      setupPageStructure();
      if (contentType === 'json') {
        renderJSONContent(rawContent, 'collapsed', DEFAULT_MESSAGES_PER_BATCH);
      } else {
        renderHL7Content(rawContent, 'collapsed', false, DEFAULT_MESSAGES_PER_BATCH);
      }
      isExtensionActive = true;
    }
  }

  // Load settings and check if paused
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.sync.get(['viewMode', 'hideEmptyFields', 'messagesPerBatch', 'extensionPaused'], function(result) {
      // If paused, don't render
      if (result.extensionPaused) {
        isExtensionActive = false;
        return;
      }

      const viewMode = result.viewMode || 'collapsed';
      const hideEmptyFields = result.hideEmptyFields || false;
      const messagesPerBatch = parseInt(result.messagesPerBatch) || DEFAULT_MESSAGES_PER_BATCH;

      setupPageStructure();

      if (contentType === 'json') {
        renderJSONContent(rawContent, viewMode, messagesPerBatch);
      } else {
        renderHL7Content(rawContent, viewMode, hideEmptyFields, messagesPerBatch);
      }
      isExtensionActive = true;
    });
  } else {
    setupPageStructure();
    if (contentType === 'json') {
      renderJSONContent(rawContent, 'collapsed', DEFAULT_MESSAGES_PER_BATCH);
    } else {
      renderHL7Content(rawContent, 'collapsed', false, DEFAULT_MESSAGES_PER_BATCH);
    }
    isExtensionActive = true;
  }

  // ========================================
  // PAGE STRUCTURE
  // ========================================

  /**
   * Setup page structure: toolbar + viewer panel + stats panel
   */
  function setupPageStructure() {
    document.body.innerHTML = '';

    // Only show toolbar for HL7 content (not JSON)
    if (contentType === 'hl7') {
      const toolbar = createToolbar();
      document.body.appendChild(toolbar);
    }

    // Viewer panel
    const viewerPanel = document.createElement('div');
    viewerPanel.className = 'hl7b-viewer-panel';
    viewerPanel.id = 'hl7bViewerPanel';
    document.body.appendChild(viewerPanel);

    // Stats panel (only for HL7)
    if (contentType === 'hl7') {
      const statsPanel = createStatsPanel();
      document.body.appendChild(statsPanel);
    }
  }

  /**
   * Create the toolbar with Viewer/Statistics toggle
   */
  function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.className = 'hl7b-toolbar';

    toolbar.innerHTML = `
      <span class="hl7b-toolbar-title">HL7 Browser</span>
      <div class="hl7b-toolbar-toggle">
        <label class="hl7b-toggle-option">
          <input type="radio" name="hl7bPageMode" value="viewer" checked>
          <span class="hl7b-toggle-chip">Viewer</span>
        </label>
        <label class="hl7b-toggle-option">
          <input type="radio" name="hl7bPageMode" value="stats">
          <span class="hl7b-toggle-chip">Statistics</span>
        </label>
      </div>
    `;

    // Wire up toggle
    toolbar.querySelectorAll('input[name="hl7bPageMode"]').forEach(radio => {
      radio.addEventListener('change', function() {
        setPageMode(this.value);
      });
    });

    return toolbar;
  }

  /**
   * Create the statistics panel
   */
  function createStatsPanel() {
    const panel = document.createElement('div');
    panel.className = 'hl7b-stats-panel';
    panel.id = 'hl7bStatsPanel';
    panel.style.display = 'none';

    panel.innerHTML = `
      <div class="stats-input-section">
        <div class="stats-input-header">
          <h2>Statistics Analysis</h2>
          <p>Filter messages and analyze field values across all HL7 messages.</p>
        </div>
        <div class="stats-input-form">
          <div class="stats-filters-section" id="statsFiltersSection">
            <div class="stats-filters-header">
              <label>Filters <span class="stats-info-icon">&#9432;
                <div class="stats-info-popup">
                  <h4>Filter Syntax</h4>
                  <table class="stats-info-table">
                    <tr><td><code>PV1.2 = E</code></td><td>Equals</td></tr>
                    <tr><td><code>PV1.2 != E</code></td><td>Not equals</td></tr>
                    <tr><td><code>PID.5 contains SMITH</code></td><td>Contains</td></tr>
                    <tr><td><code>PID.5 !contains SMITH</code></td><td>Not contains</td></tr>
                    <tr><td><code>PID.5 exists</code></td><td>Field has value</td></tr>
                    <tr><td><code>PID.5 !exists</code></td><td>Field is empty</td></tr>
                  </table>
                  <p class="stats-info-note">Filters are optional. Leave blank to analyze all messages.</p>
                </div>
              </span></label>
            </div>
            <div class="stats-filters-list" id="statsFiltersList">
              <div class="stats-filter-row" data-filter-index="1">
                <span class="stats-filter-label">F1</span>
                <input type="text" class="stats-field-input stats-filter-input" placeholder='e.g. PV1.2 = E' data-filter="1">
              </div>
            </div>
            <button type="button" class="stats-add-filter-btn" id="statsAddFilterBtn">+ Add Filter</button>
          </div>

          <div class="stats-input-group">
            <label>Field to Analyze</label>
            <input type="text" class="stats-field-input" id="statsFieldInput" placeholder="e.g. MSH.9.1, PV1.2">
          </div>

          <button type="button" class="stats-generate-btn" id="statsEvaluateBtn">Evaluate</button>
        </div>

        <div class="stats-filter-logic" id="statsFilterLogic" style="display: none;">
          <label>Filter Logic</label>
          <div class="stats-logic-options">
            <label class="stats-logic-option">
              <input type="radio" name="statsLogic" value="AND" checked>
              AND (all must match)
            </label>
            <label class="stats-logic-option">
              <input type="radio" name="statsLogic" value="OR">
              OR (any must match)
            </label>
            <label class="stats-logic-option">
              <input type="radio" name="statsLogic" value="custom">
              Custom
            </label>
          </div>
          <div class="stats-custom-logic" id="statsCustomLogic" style="display: none;">
            <input type="text" class="stats-field-input" id="statsCustomLogicInput" placeholder="e.g. F1 AND (F2 OR F3)">
            <p class="stats-custom-logic-hint">Use F1, F2, etc. with AND, OR, NOT, and parentheses.</p>
          </div>
        </div>
      </div>

      <div class="stats-results" id="statsResults"></div>
    `;

    // Wire up event handlers after the panel is in the DOM
    setTimeout(() => setupStatsEventHandlers(), 0);

    return panel;
  }

  /**
   * Setup event handlers for the stats panel
   */
  function setupStatsEventHandlers() {
    // Add filter button
    const addFilterBtn = document.getElementById('statsAddFilterBtn');
    if (addFilterBtn) {
      addFilterBtn.addEventListener('click', addFilterRow);
    }

    // Evaluate button
    const evaluateBtn = document.getElementById('statsEvaluateBtn');
    if (evaluateBtn) {
      evaluateBtn.addEventListener('click', evaluateStatistics);
    }

    // Enter key on field input
    const fieldInput = document.getElementById('statsFieldInput');
    if (fieldInput) {
      fieldInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          evaluateStatistics();
        }
      });
    }

    // Enter key on filter inputs (delegated)
    const filtersSection = document.getElementById('statsFiltersSection');
    if (filtersSection) {
      filtersSection.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.target.classList.contains('stats-filter-input')) {
          evaluateStatistics();
        }
      });
    }

    // Logic radio buttons
    const logicRadios = document.querySelectorAll('input[name="statsLogic"]');
    logicRadios.forEach(radio => {
      radio.addEventListener('change', function() {
        const customLogicDiv = document.getElementById('statsCustomLogic');
        if (customLogicDiv) {
          customLogicDiv.style.display = this.value === 'custom' ? 'block' : 'none';
        }
      });
    });

    // Enter key on custom logic input
    const customLogicInput = document.getElementById('statsCustomLogicInput');
    if (customLogicInput) {
      customLogicInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          evaluateStatistics();
        }
      });
    }
  }

  /**
   * Add a new filter row
   */
  function addFilterRow() {
    const filtersList = document.getElementById('statsFiltersList');
    if (!filtersList) return;

    const existingRows = filtersList.querySelectorAll('.stats-filter-row');
    const newIndex = existingRows.length + 1;

    const row = document.createElement('div');
    row.className = 'stats-filter-row';
    row.dataset.filterIndex = newIndex;
    row.innerHTML = `
      <span class="stats-filter-label">F${newIndex}</span>
      <input type="text" class="stats-field-input stats-filter-input" placeholder='e.g. PID.5 contains SMITH' data-filter="${newIndex}">
      <button type="button" class="stats-filter-remove-btn" title="Remove filter">&#10005;</button>
    `;

    // Wire up remove button
    row.querySelector('.stats-filter-remove-btn').addEventListener('click', function() {
      row.remove();
      renumberFilters();
      updateFilterLogicVisibility();
    });

    filtersList.appendChild(row);
    updateFilterLogicVisibility();

    // Focus the new input
    row.querySelector('.stats-filter-input').focus();
  }

  /**
   * Renumber filter rows after removal
   */
  function renumberFilters() {
    const filtersList = document.getElementById('statsFiltersList');
    if (!filtersList) return;

    const rows = filtersList.querySelectorAll('.stats-filter-row');
    rows.forEach((row, idx) => {
      const newIndex = idx + 1;
      row.dataset.filterIndex = newIndex;
      row.querySelector('.stats-filter-label').textContent = `F${newIndex}`;
      row.querySelector('.stats-filter-input').dataset.filter = newIndex;
    });
  }

  /**
   * Show/hide filter logic section based on number of filters
   */
  function updateFilterLogicVisibility() {
    const filtersList = document.getElementById('statsFiltersList');
    const logicSection = document.getElementById('statsFilterLogic');
    if (!filtersList || !logicSection) return;

    const filledFilters = filtersList.querySelectorAll('.stats-filter-input');
    let filledCount = 0;
    filledFilters.forEach(input => {
      if (input.value.trim()) filledCount++;
    });

    const totalRows = filtersList.querySelectorAll('.stats-filter-row').length;
    logicSection.style.display = totalRows > 1 ? 'block' : 'none';
  }

  /**
   * Evaluate statistics based on current inputs
   */
  function evaluateStatistics() {
    const fieldInput = document.getElementById('statsFieldInput');
    const fieldRef = fieldInput ? fieldInput.value.trim() : '';

    // Gather filters
    const filterInputs = document.querySelectorAll('.stats-filter-input');
    const filters = [];
    filterInputs.forEach(input => {
      const expr = input.value.trim();
      if (expr) {
        filters.push({
          label: `F${input.dataset.filter}`,
          expression: expr
        });
      }
    });

    // If no filters and no field, show hint
    if (filters.length === 0 && !fieldRef) {
      const resultsContainer = document.getElementById('statsResults');
      if (resultsContainer) {
        resultsContainer.innerHTML = '<div class="stats-error">Please enter a filter expression and/or a field to analyze.</div>';
      }
      return;
    }

    // Build filters config
    let filtersConfig = null;
    if (filters.length > 0) {
      let logic = 'single';
      let expression = '';

      if (filters.length > 1) {
        const logicRadio = document.querySelector('input[name="statsLogic"]:checked');
        logic = logicRadio ? logicRadio.value : 'AND';

        if (logic === 'custom') {
          const customInput = document.getElementById('statsCustomLogicInput');
          expression = customInput ? customInput.value.trim() : '';
        }
      }

      filtersConfig = {
        filters: filters,
        logic: logic,
        expression: expression
      };
    }

    // Update filter logic visibility
    updateFilterLogicVisibility();

    // Run statistics
    if (typeof HL7Stats !== 'undefined') {
      HL7Stats.runStatistics(rawContent, fieldRef, 'statsResults', filtersConfig);

      // Setup collapse listeners for any tree views rendered inside stats
      setupCollapseListenersForElement(document.getElementById('statsResults'));
    }
  }

  /**
   * Set the page mode (viewer or stats)
   */
  function setPageMode(mode) {
    currentPageMode = mode;

    const viewerPanel = document.getElementById('hl7bViewerPanel');
    const statsPanel = document.getElementById('hl7bStatsPanel');

    if (mode === 'viewer') {
      if (viewerPanel) viewerPanel.style.display = '';
      if (statsPanel) statsPanel.style.display = 'none';
    } else {
      if (viewerPanel) viewerPanel.style.display = 'none';
      if (statsPanel) statsPanel.style.display = 'block';
    }
  }

  /**
   * Detect content type (json or hl7)
   */
  function detectContentType(content) {
    const trimmed = content.trim();

    // Check for JSON first
    if (isJSONContent(trimmed)) {
      return 'json';
    }

    // Check for HL7
    if (isHL7Content(content)) {
      return 'hl7';
    }

    return null;
  }

  /**
   * Check if the content appears to be JSON formatted
   */
  function isJSONContent(content) {
    const trimmed = content.trim();

    // Quick check: must start with { or [
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return false;
    }

    // Try to parse it
    try {
      JSON.parse(trimmed);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if the content appears to be HL7 formatted
   */
  function isHL7Content(content) {
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return false;

    // Check if any line starts with a known HL7 segment
    let hl7LineCount = 0;
    for (const line of lines) {
      const segmentId = line.substring(0, 3);
      if (HL7_SEGMENT_IDS.includes(segmentId)) {
        hl7LineCount++;
      }
    }

    // Consider it HL7 if at least 30% of lines are HL7 segments or has MSH
    const hasMSH = lines.some(line => line.startsWith('MSH'));
    return hasMSH || (hl7LineCount / lines.length > 0.3);
  }

  /**
   * Parse and render the HL7 content with interactive elements
   */
  function renderHL7Content(content, viewMode, hideEmptyFields, messagesPerBatch) {
    if (viewMode === 'collapsed') {
      renderCollapsedView(content, hideEmptyFields, messagesPerBatch);
    } else {
      renderStandardView(content, messagesPerBatch);
    }
  }

  /**
   * Render the standard inline view with hover tooltips
   */
  function renderStandardView(content, messagesPerBatch) {
    const viewerPanel = document.getElementById('hl7bViewerPanel');
    if (!viewerPanel) return;

    // Create the main container
    const container = document.createElement('div');
    container.className = 'hl7-container hl7-standard-view';

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'hl7-tooltip';
    tooltip.style.display = 'none';

    // Split content into lines and group by messages
    const lines = content.split(/\r?\n/);
    const messageGroups = groupLinesByMessage(lines);

    // State for pagination
    let renderedCount = 0;
    const totalMessages = messageGroups.length;

    // Render first batch
    renderedCount = renderStandardBatch(container, messageGroups, 0, messagesPerBatch);

    // Place content in viewer panel
    viewerPanel.innerHTML = '';
    viewerPanel.appendChild(container);
    viewerPanel.appendChild(tooltip);

    // Add "Load More" button if there are more messages
    if (renderedCount < totalMessages) {
      const loadMoreBtn = createLoadMoreButton(totalMessages, renderedCount);
      container.appendChild(loadMoreBtn);

      loadMoreBtn.addEventListener('click', function() {
        // Remove the button temporarily
        loadMoreBtn.remove();

        // Render next batch
        const newCount = renderStandardBatch(container, messageGroups, renderedCount, messagesPerBatch);
        renderedCount = newCount;

        // Add button back if still more to load
        if (renderedCount < totalMessages) {
          updateLoadMoreButton(loadMoreBtn, totalMessages, renderedCount);
          container.appendChild(loadMoreBtn);
        }
      });
    }

    // Add event listeners for tooltips
    setupTooltipListeners(tooltip);
  }

  /**
   * Group lines by message (each message starts with MSH)
   */
  function groupLinesByMessage(lines) {
    const messageGroups = [];
    let currentGroup = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('MSH')) {
        if (currentGroup.length > 0) {
          messageGroups.push(currentGroup);
        }
        currentGroup = [line];
      } else {
        currentGroup.push(line);
      }
    }

    // Don't forget the last group
    if (currentGroup.length > 0) {
      messageGroups.push(currentGroup);
    }

    return messageGroups;
  }

  /**
   * Render a batch of messages in standard view
   */
  function renderStandardBatch(container, messageGroups, startIndex, batchSize) {
    const endIndex = Math.min(startIndex + batchSize, messageGroups.length);

    // Track message context (encoding characters)
    let fieldSeparator = '|';
    let componentSeparator = '^';
    let repetitionSeparator = '~';
    let escapeCharacter = '\\';
    let subcomponentSeparator = '&';

    for (let m = startIndex; m < endIndex; m++) {
      const messageLines = messageGroups[m];

      // Add message separator if not the first message
      if (m > 0) {
        const separatorDiv = document.createElement('div');
        separatorDiv.className = 'hl7-message-separator';
        container.appendChild(separatorDiv);
      }

      for (const line of messageLines) {
        const trimmedLine = line.trim();

        if (!trimmedLine) {
          // Empty line
          const lineDiv = document.createElement('div');
          lineDiv.className = 'hl7-line hl7-empty';
          lineDiv.innerHTML = '&nbsp;';
          container.appendChild(lineDiv);
          continue;
        }

        const segmentId = trimmedLine.substring(0, 3);

        if (!HL7_SEGMENT_IDS.includes(segmentId)) {
          // Non-HL7 line (comment or other)
          const lineDiv = document.createElement('div');
          lineDiv.className = 'hl7-line hl7-comment';
          lineDiv.textContent = trimmedLine;
          container.appendChild(lineDiv);
          continue;
        }

        // Parse MSH segment to get encoding characters
        if (segmentId === 'MSH') {
          if (trimmedLine.length > 3) {
            fieldSeparator = trimmedLine[3];
          }
          if (trimmedLine.length > 7) {
            const encodingChars = trimmedLine.substring(4, 8);
            componentSeparator = encodingChars[0] || '^';
            repetitionSeparator = encodingChars[1] || '~';
            escapeCharacter = encodingChars[2] || '\\';
            subcomponentSeparator = encodingChars[3] || '&';
          }
        }

        // Create line container
        const lineDiv = document.createElement('div');
        lineDiv.className = 'hl7-line';
        lineDiv.dataset.segment = segmentId;

        // Parse and render the segment
        const parsedSegment = parseSegment(
          trimmedLine,
          segmentId,
          fieldSeparator,
          componentSeparator,
          repetitionSeparator,
          subcomponentSeparator
        );

        // Create segment name span
        const segmentSpan = document.createElement('span');
        segmentSpan.className = 'hl7-segment-id';
        segmentSpan.textContent = segmentId;
        segmentSpan.dataset.segment = segmentId;
        segmentSpan.dataset.tooltipText = getSegmentTooltip(segmentId);
        lineDiv.appendChild(segmentSpan);

        // Handle MSH specially - field separator is MSH.1
        if (segmentId === 'MSH') {
          // Add the field separator as MSH.1
          const sepSpan = document.createElement('span');
          sepSpan.className = 'hl7-field';
          sepSpan.textContent = fieldSeparator;
          sepSpan.dataset.segment = 'MSH';
          sepSpan.dataset.field = '1';
          sepSpan.dataset.tooltipText = 'MSH.1 - Field Separator';
          lineDiv.appendChild(sepSpan);

          // Add encoding characters as MSH.2
          if (parsedSegment.fields.length > 0) {
            const encSpan = createFieldSpan(
              parsedSegment.fields[0],
              'MSH',
              2,
              componentSeparator,
              subcomponentSeparator
            );
            lineDiv.appendChild(encSpan);
          }

          // Add remaining fields starting from index 1 (which is MSH.3)
          for (let i = 1; i < parsedSegment.fields.length; i++) {
            const sepSpan = document.createElement('span');
            sepSpan.className = 'hl7-separator';
            sepSpan.textContent = fieldSeparator;
            lineDiv.appendChild(sepSpan);

            const fieldSpan = createFieldSpan(
              parsedSegment.fields[i],
              segmentId,
              i + 2, // MSH fields are offset by 2
              componentSeparator,
              subcomponentSeparator
            );
            lineDiv.appendChild(fieldSpan);
          }
        } else {
          // Regular segment
          for (let i = 0; i < parsedSegment.fields.length; i++) {
            const sepSpan = document.createElement('span');
            sepSpan.className = 'hl7-separator';
            sepSpan.textContent = fieldSeparator;
            lineDiv.appendChild(sepSpan);

            const fieldSpan = createFieldSpan(
              parsedSegment.fields[i],
              segmentId,
              i + 1,
              componentSeparator,
              subcomponentSeparator
            );
            lineDiv.appendChild(fieldSpan);
          }
        }

        container.appendChild(lineDiv);
      }
    }

    return endIndex;
  }

  /**
   * Create the "Load More" button
   */
  function createLoadMoreButton(total, loaded) {
    const btn = document.createElement('button');
    btn.className = 'hl7-load-more';
    btn.innerHTML = `Load More <span class="hl7-load-more-count">(showing ${loaded} of ${total} messages)</span>`;
    return btn;
  }

  /**
   * Update the "Load More" button text
   */
  function updateLoadMoreButton(btn, total, loaded) {
    btn.innerHTML = `Load More <span class="hl7-load-more-count">(showing ${loaded} of ${total} messages)</span>`;
  }

  /**
   * Render the collapsed/tree view with expandable segments
   */
  function renderCollapsedView(content, hideEmptyFields, messagesPerBatch) {
    const viewerPanel = document.getElementById('hl7bViewerPanel');
    if (!viewerPanel) return;

    // Create the main container
    const container = document.createElement('div');
    container.className = 'hl7-container hl7-collapsed-view';

    // Split content into lines and parse into messages
    const lines = content.split(/\r?\n/);
    const messages = parseIntoMessages(lines);

    // State for pagination
    let renderedCount = 0;
    const totalMessages = messages.length;

    // Render first batch
    renderedCount = renderCollapsedBatch(container, messages, 0, messagesPerBatch, hideEmptyFields);

    // Place content in viewer panel
    viewerPanel.innerHTML = '';
    viewerPanel.appendChild(container);

    // Add "Load More" button if there are more messages
    if (renderedCount < totalMessages) {
      const loadMoreBtn = createLoadMoreButton(totalMessages, renderedCount);
      container.appendChild(loadMoreBtn);

      loadMoreBtn.addEventListener('click', function() {
        // Remove the button temporarily
        loadMoreBtn.remove();

        // Render next batch
        const newCount = renderCollapsedBatch(container, messages, renderedCount, messagesPerBatch, hideEmptyFields);
        renderedCount = newCount;

        // Add button back if still more to load
        if (renderedCount < totalMessages) {
          updateLoadMoreButton(loadMoreBtn, totalMessages, renderedCount);
          container.appendChild(loadMoreBtn);
        }
      });
    }

    // Setup expand/collapse listeners
    setupCollapseListeners();
  }

  /**
   * Render a batch of messages in collapsed/tree view
   */
  function renderCollapsedBatch(container, messages, startIndex, batchSize, hideEmptyFields) {
    const endIndex = Math.min(startIndex + batchSize, messages.length);

    for (let m = startIndex; m < endIndex; m++) {
      const message = messages[m];
      const messageDiv = createMessageNode(message, m, hideEmptyFields);
      container.appendChild(messageDiv);
    }

    return endIndex;
  }

  /**
   * Parse lines into separate messages (each starting with MSH)
   */
  function parseIntoMessages(lines) {
    const messages = [];
    let currentMessage = null;
    let fieldSeparator = '|';
    let componentSeparator = '^';
    let subcomponentSeparator = '&';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const segmentId = trimmedLine.substring(0, 3);

      if (segmentId === 'MSH') {
        // Start a new message
        if (currentMessage) {
          messages.push(currentMessage);
        }

        // Parse encoding characters
        if (trimmedLine.length > 3) {
          fieldSeparator = trimmedLine[3];
        }
        if (trimmedLine.length > 7) {
          const encodingChars = trimmedLine.substring(4, 8);
          componentSeparator = encodingChars[0] || '^';
          subcomponentSeparator = encodingChars[3] || '&';
        }

        currentMessage = {
          fieldSeparator,
          componentSeparator,
          subcomponentSeparator,
          segments: []
        };
      }

      if (currentMessage && HL7_SEGMENT_IDS.includes(segmentId)) {
        const parsed = parseSegment(trimmedLine, segmentId, fieldSeparator, componentSeparator, '~', subcomponentSeparator);
        currentMessage.segments.push({
          segmentId,
          rawLine: trimmedLine,
          fields: parsed.fields,
          fieldSeparator,
          componentSeparator,
          subcomponentSeparator
        });
      }
    }

    // Don't forget the last message
    if (currentMessage) {
      messages.push(currentMessage);
    }

    return messages;
  }

  /**
   * Create a message node for the collapsed view
   */
  function createMessageNode(message, msgIndex, hideEmptyFields) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'hl7-tree-message';

    // Get message type from MSH.9 if available
    let messageType = 'HL7 Message';
    const mshSegment = message.segments.find(s => s.segmentId === 'MSH');
    if (mshSegment && mshSegment.fields.length > 7) {
      const msgTypeField = mshSegment.fields[7]; // MSH.9 (0-indexed: field 7 after encoding chars)
      if (msgTypeField) {
        const parts = msgTypeField.split(message.componentSeparator);
        messageType = parts.slice(0, 2).filter(p => p).join('^') || 'HL7 Message';
      }
    }

    // Get patient name from PID.5 if available
    let patientName = '';
    const pidSegment = message.segments.find(s => s.segmentId === 'PID');
    if (pidSegment && pidSegment.fields.length > 4) {
      const nameField = pidSegment.fields[4]; // PID.5 (0-indexed: field 4)
      if (nameField && nameField.trim()) {
        patientName = nameField;
      }
    }

    // Build message title
    let messageTitle = `Message ${msgIndex + 1}: ${escapeHtml(messageType)}`;
    if (patientName) {
      messageTitle += `, ${escapeHtml(patientName)}`;
    }

    // Message header
    const messageHeader = document.createElement('div');
    messageHeader.className = 'hl7-tree-header hl7-tree-message-header collapsed';
    messageHeader.innerHTML = `
      <span class="hl7-tree-toggle">&#9654;</span>
      <span class="hl7-tree-icon">&#128232;</span>
      <span class="hl7-tree-title">${messageTitle}</span>
      <span class="hl7-tree-count">${message.segments.length} segments</span>
    `;
    messageDiv.appendChild(messageHeader);

    // Message content (segments)
    const messageContent = document.createElement('div');
    messageContent.className = 'hl7-tree-content';
    messageContent.style.display = 'none';

    message.segments.forEach(segment => {
      const segmentNode = createSegmentNode(segment, hideEmptyFields);
      messageContent.appendChild(segmentNode);
    });

    messageDiv.appendChild(messageContent);

    return messageDiv;
  }

  /**
   * Create a segment node for the collapsed view
   */
  function createSegmentNode(segment, hideEmptyFields) {
    const segmentDiv = document.createElement('div');
    segmentDiv.className = 'hl7-tree-segment';

    const segmentInfo = HL7_SEGMENTS[segment.segmentId];
    const segmentName = segmentInfo ? segmentInfo.name : 'Unknown Segment';

    // Count non-empty fields
    const nonEmptyFields = segment.fields.filter(f => f && f.trim()).length;

    // Segment header
    const segmentHeader = document.createElement('div');
    segmentHeader.className = 'hl7-tree-header hl7-tree-segment-header collapsed';
    segmentHeader.dataset.segment = segment.segmentId;
    segmentHeader.innerHTML = `
      <span class="hl7-tree-toggle">&#9654;</span>
      <span class="hl7-tree-segment-id">${segment.segmentId}</span>
      <span class="hl7-tree-segment-name">${escapeHtml(segmentName)}</span>
      <span class="hl7-tree-count">${nonEmptyFields} fields</span>
    `;
    segmentDiv.appendChild(segmentHeader);

    // Segment content (fields)
    const segmentContent = document.createElement('div');
    segmentContent.className = 'hl7-tree-content';
    segmentContent.style.display = 'none';

    // Handle MSH specially
    if (segment.segmentId === 'MSH') {
      // MSH.1 - Field Separator (always show)
      const field1Node = createFieldNode(segment.segmentId, 1, segment.fieldSeparator, null, segment.componentSeparator, segment.subcomponentSeparator, hideEmptyFields);
      if (field1Node) segmentContent.appendChild(field1Node);

      // MSH.2 - Encoding Characters (always show)
      const field2Node = createFieldNode(segment.segmentId, 2, segment.fields[0], null, segment.componentSeparator, segment.subcomponentSeparator, hideEmptyFields);
      if (field2Node) segmentContent.appendChild(field2Node);

      // Remaining fields
      for (let i = 1; i < segment.fields.length; i++) {
        const fieldNum = i + 2;
        const fieldValue = segment.fields[i];
        // Skip empty fields if hideEmptyFields is enabled
        if (hideEmptyFields && (!fieldValue || !fieldValue.trim())) continue;
        const fieldNode = createFieldNode(segment.segmentId, fieldNum, fieldValue, segmentInfo, segment.componentSeparator, segment.subcomponentSeparator, hideEmptyFields);
        if (fieldNode) segmentContent.appendChild(fieldNode);
      }
    } else {
      // Regular segment
      for (let i = 0; i < segment.fields.length; i++) {
        const fieldNum = i + 1;
        const fieldValue = segment.fields[i];
        // Skip empty fields if hideEmptyFields is enabled
        if (hideEmptyFields && (!fieldValue || !fieldValue.trim())) continue;
        const fieldNode = createFieldNode(segment.segmentId, fieldNum, fieldValue, segmentInfo, segment.componentSeparator, segment.subcomponentSeparator, hideEmptyFields);
        if (fieldNode) segmentContent.appendChild(fieldNode);
      }
    }

    segmentDiv.appendChild(segmentContent);

    return segmentDiv;
  }

  /**
   * Create a field node for the collapsed view
   */
  function createFieldNode(segmentId, fieldNum, fieldValue, segmentInfo, compSep, subcompSep, hideEmptyFields) {
    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'hl7-tree-field';

    // Get field info
    let fieldName = `Field ${fieldNum}`;
    let fieldDef = null;
    if (segmentInfo && segmentInfo.fields && segmentInfo.fields[fieldNum]) {
      fieldDef = segmentInfo.fields[fieldNum];
      fieldName = fieldDef.name;
    }

    const displayValue = fieldValue || '(empty)';
    const hasComponents = fieldValue && fieldValue.includes(compSep);
    const isEmpty = !fieldValue || !fieldValue.trim();

    if (hasComponents) {
      // Field with components - make it expandable
      const fieldHeader = document.createElement('div');
      fieldHeader.className = 'hl7-tree-header hl7-tree-field-header collapsed';
      fieldHeader.innerHTML = `
        <span class="hl7-tree-toggle">&#9654;</span>
        <span class="hl7-tree-field-id">${segmentId}.${fieldNum}</span>
        <span class="hl7-tree-field-name">${escapeHtml(fieldName)}</span>
      `;
      fieldDiv.appendChild(fieldHeader);

      // Field content (components)
      const fieldContent = document.createElement('div');
      fieldContent.className = 'hl7-tree-content';
      fieldContent.style.display = 'none';

      const components = fieldValue.split(compSep);
      components.forEach((comp, compIndex) => {
        const compNum = compIndex + 1;
        // Skip empty components if hideEmptyFields is enabled
        if (hideEmptyFields && (!comp || !comp.trim())) return;
        const compNode = createComponentNode(segmentId, fieldNum, compNum, comp, fieldDef, subcompSep, hideEmptyFields);
        fieldContent.appendChild(compNode);
      });

      fieldDiv.appendChild(fieldContent);
    } else {
      // Simple field - just show inline
      fieldDiv.className += isEmpty ? ' hl7-tree-field-empty' : '';
      fieldDiv.innerHTML = `
        <span class="hl7-tree-field-id">${segmentId}.${fieldNum}</span>
        <span class="hl7-tree-field-name">${escapeHtml(fieldName)}</span>
        <span class="hl7-tree-field-value ${isEmpty ? 'empty' : ''}">${escapeHtml(displayValue)}</span>
      `;
    }

    return fieldDiv;
  }

  /**
   * Create a component node for the collapsed view
   */
  function createComponentNode(segmentId, fieldNum, compNum, compValue, fieldDef, subcompSep, hideEmptyFields) {
    const compDiv = document.createElement('div');
    compDiv.className = 'hl7-tree-component';

    // Get component name
    let compName = `Component ${compNum}`;
    if (fieldDef && fieldDef.components && fieldDef.components[compNum]) {
      compName = fieldDef.components[compNum];
    }

    const displayValue = compValue || '(empty)';
    const hasSubcomponents = compValue && compValue.includes(subcompSep);
    const isEmpty = !compValue || !compValue.trim();

    if (hasSubcomponents) {
      // Component with subcomponents - make it expandable
      const compHeader = document.createElement('div');
      compHeader.className = 'hl7-tree-header hl7-tree-component-header collapsed';
      compHeader.innerHTML = `
        <span class="hl7-tree-toggle">&#9654;</span>
        <span class="hl7-tree-comp-id">${segmentId}.${fieldNum}.${compNum}</span>
        <span class="hl7-tree-comp-name">${escapeHtml(compName)}</span>
      `;
      compDiv.appendChild(compHeader);

      // Component content (subcomponents)
      const compContent = document.createElement('div');
      compContent.className = 'hl7-tree-content';
      compContent.style.display = 'none';

      const subcomponents = compValue.split(subcompSep);
      subcomponents.forEach((subcomp, subcompIndex) => {
        const subcompNum = subcompIndex + 1;
        // Skip empty subcomponents if hideEmptyFields is enabled
        if (hideEmptyFields && (!subcomp || !subcomp.trim())) return;
        const subcompDiv = document.createElement('div');
        subcompDiv.className = 'hl7-tree-subcomponent';
        const subcompEmpty = !subcomp || !subcomp.trim();
        subcompDiv.innerHTML = `
          <span class="hl7-tree-subcomp-id">${segmentId}.${fieldNum}.${compNum}.${subcompNum}</span>
          <span class="hl7-tree-subcomp-name">Subcomponent ${subcompNum}</span>
          <span class="hl7-tree-subcomp-value ${subcompEmpty ? 'empty' : ''}">${escapeHtml(subcomp || '(empty)')}</span>
        `;
        compContent.appendChild(subcompDiv);
      });

      compDiv.appendChild(compContent);
    } else {
      // Simple component - just show inline
      compDiv.className += isEmpty ? ' hl7-tree-component-empty' : '';
      compDiv.innerHTML = `
        <span class="hl7-tree-comp-id">${segmentId}.${fieldNum}.${compNum}</span>
        <span class="hl7-tree-comp-name">${escapeHtml(compName)}</span>
        <span class="hl7-tree-comp-value ${isEmpty ? 'empty' : ''}">${escapeHtml(displayValue)}</span>
      `;
    }

    return compDiv;
  }

  /**
   * Setup expand/collapse click listeners (on document.body)
   */
  function setupCollapseListeners() {
    document.body.addEventListener('click', function(e) {
      handleTreeClick(e);
    });
  }

  /**
   * Setup expand/collapse click listeners scoped to a specific element
   */
  function setupCollapseListenersForElement(el) {
    if (!el) return;
    el.addEventListener('click', function(e) {
      handleTreeClick(e);
    });
  }

  /**
   * Handle tree expand/collapse click
   */
  function handleTreeClick(e) {
    const header = e.target.closest('.hl7-tree-header');
    if (!header) return;

    const content = header.nextElementSibling;
    if (!content || !content.classList.contains('hl7-tree-content')) return;

    const isCollapsed = header.classList.contains('collapsed');

    if (isCollapsed) {
      // Expand
      header.classList.remove('collapsed');
      header.classList.add('expanded');
      content.style.display = 'block';
      // Update toggle icon
      const toggle = header.querySelector('.hl7-tree-toggle');
      if (toggle) toggle.innerHTML = '&#9660;';
    } else {
      // Collapse
      header.classList.remove('expanded');
      header.classList.add('collapsed');
      content.style.display = 'none';
      // Update toggle icon
      const toggle = header.querySelector('.hl7-tree-toggle');
      if (toggle) toggle.innerHTML = '&#9654;';
    }
  }

  /**
   * Render HL7 content into a specific container element (for filtered messages viewer)
   */
  function renderHL7IntoContainer(container, content, viewMode) {
    container.innerHTML = '';

    // Normalize line endings: \r\n -> \n, then standalone \r -> \n
    var normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    if (viewMode === 'collapsed') {
      container.className = 'hl7-container hl7-collapsed-view';
      const lines = normalizedContent.split('\n');
      const messages = parseIntoMessages(lines);
      renderCollapsedBatch(container, messages, 0, messages.length, false);
    } else {
      container.className = 'hl7-container hl7-standard-view';
      const lines = normalizedContent.split('\n');
      const messageGroups = groupLinesByMessage(lines);
      renderStandardBatch(container, messageGroups, 0, messageGroups.length);

      // Create and attach tooltip for standard view
      let tooltip = container.querySelector('.hl7-tooltip');
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'hl7-tooltip';
        tooltip.style.display = 'none';
        container.appendChild(tooltip);
      }
      setupTooltipListeners(tooltip);
    }
  }

  /**
   * Escape HTML special characters
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Parse a segment into its fields
   */
  function parseSegment(line, segmentId, fieldSep, compSep, repSep, subcompSep) {
    let fields;

    if (segmentId === 'MSH') {
      // MSH is special - the field separator is part of the segment
      // Split starting after the field separator (position 4)
      const afterSep = line.substring(4);
      fields = afterSep.split(fieldSep);
    } else {
      // Regular segment - split after the segment ID
      const afterId = line.substring(3);
      if (afterId.startsWith(fieldSep)) {
        fields = afterId.substring(1).split(fieldSep);
      } else {
        fields = afterId.split(fieldSep);
      }
    }

    return { segmentId, fields };
  }

  /**
   * Create a span element for a field with component-level hovering (standard view)
   */
  function createFieldSpan(fieldValue, segmentId, fieldNum, compSep, subcompSep) {
    const fieldSpan = document.createElement('span');
    fieldSpan.className = 'hl7-field';
    fieldSpan.dataset.segment = segmentId;
    fieldSpan.dataset.field = fieldNum;

    // Check if this field has components
    if (fieldValue && fieldValue.includes(compSep)) {
      const components = fieldValue.split(compSep);

      for (let c = 0; c < components.length; c++) {
        if (c > 0) {
          const compSepSpan = document.createElement('span');
          compSepSpan.className = 'hl7-comp-separator';
          compSepSpan.textContent = compSep;
          fieldSpan.appendChild(compSepSpan);
        }

        const component = components[c];

        // Check for subcomponents
        if (component && component.includes(subcompSep)) {
          const subcomponents = component.split(subcompSep);
          for (let s = 0; s < subcomponents.length; s++) {
            if (s > 0) {
              const subcompSepSpan = document.createElement('span');
              subcompSepSpan.className = 'hl7-subcomp-separator';
              subcompSepSpan.textContent = subcompSep;
              fieldSpan.appendChild(subcompSepSpan);
            }

            const subcompSpan = document.createElement('span');
            subcompSpan.className = 'hl7-subcomponent';
            subcompSpan.textContent = subcomponents[s];
            subcompSpan.dataset.segment = segmentId;
            subcompSpan.dataset.field = fieldNum;
            subcompSpan.dataset.component = c + 1;
            subcompSpan.dataset.subcomponent = s + 1;
            subcompSpan.dataset.tooltipText = getSubcomponentTooltip(segmentId, fieldNum, c + 1, s + 1);
            fieldSpan.appendChild(subcompSpan);
          }
        } else {
          const compSpan = document.createElement('span');
          compSpan.className = 'hl7-component';
          compSpan.textContent = component;
          compSpan.dataset.segment = segmentId;
          compSpan.dataset.field = fieldNum;
          compSpan.dataset.component = c + 1;
          compSpan.dataset.tooltipText = getComponentTooltip(segmentId, fieldNum, c + 1);
          fieldSpan.appendChild(compSpan);
        }
      }
    } else {
      // Simple field without components
      fieldSpan.textContent = fieldValue || '';
      fieldSpan.dataset.tooltipText = getFieldTooltip(segmentId, fieldNum);
    }

    return fieldSpan;
  }

  /**
   * Get tooltip text for a segment
   */
  function getSegmentTooltip(segmentId) {
    const segment = HL7_SEGMENTS[segmentId];
    if (segment) {
      return `${segmentId} - ${segment.name}`;
    }
    return segmentId;
  }

  /**
   * Get tooltip text for a field
   */
  function getFieldTooltip(segmentId, fieldNum) {
    const segment = HL7_SEGMENTS[segmentId];
    if (segment && segment.fields && segment.fields[fieldNum]) {
      return `${segmentId}.${fieldNum} - ${segment.fields[fieldNum].name}`;
    }
    return `${segmentId}.${fieldNum}`;
  }

  /**
   * Get tooltip text for a component
   */
  function getComponentTooltip(segmentId, fieldNum, compNum) {
    const segment = HL7_SEGMENTS[segmentId];
    if (segment && segment.fields && segment.fields[fieldNum]) {
      const field = segment.fields[fieldNum];
      if (field.components && field.components[compNum]) {
        return `${segmentId}.${fieldNum}.${compNum} - ${field.components[compNum]}`;
      }
      return `${segmentId}.${fieldNum}.${compNum} (${field.name})`;
    }
    return `${segmentId}.${fieldNum}.${compNum}`;
  }

  /**
   * Get tooltip text for a subcomponent
   */
  function getSubcomponentTooltip(segmentId, fieldNum, compNum, subcompNum) {
    const segment = HL7_SEGMENTS[segmentId];
    if (segment && segment.fields && segment.fields[fieldNum]) {
      const field = segment.fields[fieldNum];
      if (field.components && field.components[compNum]) {
        return `${segmentId}.${fieldNum}.${compNum}.${subcompNum} - ${field.components[compNum]} (subcomponent ${subcompNum})`;
      }
      return `${segmentId}.${fieldNum}.${compNum}.${subcompNum} (${field.name})`;
    }
    return `${segmentId}.${fieldNum}.${compNum}.${subcompNum}`;
  }

  /**
   * Setup tooltip event listeners (standard view)
   */
  function setupTooltipListeners(tooltip) {
    // Elements that can show tooltips
    const hoverableSelectors = [
      '.hl7-segment-id',
      '.hl7-field',
      '.hl7-component',
      '.hl7-subcomponent'
    ].join(', ');

    document.body.addEventListener('mouseover', function(e) {
      const target = e.target.closest(hoverableSelectors);
      if (target && target.dataset.tooltipText) {
        showTooltip(tooltip, target, target.dataset.tooltipText);
      }
    });

    document.body.addEventListener('mouseout', function(e) {
      const target = e.target.closest(hoverableSelectors);
      if (target) {
        hideTooltip(tooltip);
      }
    });

    // Also handle when hovering over fields that contain components
    document.body.addEventListener('mouseover', function(e) {
      if (e.target.classList.contains('hl7-field') && !e.target.dataset.tooltipText) {
        // Field with components - show field-level tooltip
        const segmentId = e.target.dataset.segment;
        const fieldNum = e.target.dataset.field;
        const tooltipText = getFieldTooltip(segmentId, parseInt(fieldNum));

        // Only show if we're directly on the field container (not a component)
        if (e.target === e.target) {
          e.target.dataset.tooltipText = tooltipText;
        }
      }
    });
  }

  /**
   * Show tooltip near the target element
   */
  function showTooltip(tooltip, target, text) {
    tooltip.textContent = text;
    tooltip.style.display = 'block';

    // Position the tooltip
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 5;

    // Adjust if tooltip would go off screen
    if (left + tooltipRect.width > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width - 10;
    }
    if (left < 0) {
      left = 10;
    }

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    // Add highlight to target
    target.classList.add('hl7-hover');
  }

  /**
   * Hide tooltip
   */
  function hideTooltip(tooltip) {
    tooltip.style.display = 'none';

    // Remove highlights
    document.querySelectorAll('.hl7-hover').forEach(el => {
      el.classList.remove('hl7-hover');
    });
  }

  // ========================================
  // JSON RENDERING FUNCTIONS
  // ========================================

  /**
   * Parse and render JSON content
   */
  function renderJSONContent(content, viewMode, messagesPerBatch) {
    const parsed = JSON.parse(content.trim());

    if (viewMode === 'collapsed') {
      renderJSONCollapsedView(parsed, messagesPerBatch);
    } else {
      renderJSONStandardView(parsed, messagesPerBatch);
    }
  }

  /**
   * Get top-level items from JSON for pagination
   * If array, each element is an item; if object, the whole thing is one item
   */
  function getJSONItems(parsed) {
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [parsed];
  }

  /**
   * Render JSON in standard/textual view (formatted JSON)
   */
  function renderJSONStandardView(parsed, messagesPerBatch) {
    const viewerPanel = document.getElementById('hl7bViewerPanel');
    if (!viewerPanel) return;

    const container = document.createElement('div');
    container.className = 'hl7-container json-standard-view';

    const items = getJSONItems(parsed);
    const isArray = Array.isArray(parsed);

    let renderedCount = 0;
    const totalItems = items.length;

    // Render first batch
    renderedCount = renderJSONStandardBatch(container, items, 0, messagesPerBatch, isArray);

    // Place content in viewer panel
    viewerPanel.innerHTML = '';
    viewerPanel.appendChild(container);

    // Add "Load More" button if there are more items
    if (renderedCount < totalItems) {
      const loadMoreBtn = createLoadMoreButton(totalItems, renderedCount);
      container.appendChild(loadMoreBtn);

      loadMoreBtn.addEventListener('click', function() {
        loadMoreBtn.remove();
        const newCount = renderJSONStandardBatch(container, items, renderedCount, messagesPerBatch, isArray);
        renderedCount = newCount;

        if (renderedCount < totalItems) {
          updateLoadMoreButton(loadMoreBtn, totalItems, renderedCount);
          container.appendChild(loadMoreBtn);
        }
      });
    }

    // Setup JSON context menu for Python path copying
    setupJSONContextMenu();
  }

  /**
   * Render a batch of JSON items in standard view
   */
  function renderJSONStandardBatch(container, items, startIndex, batchSize, isArray) {
    const endIndex = Math.min(startIndex + batchSize, items.length);

    for (let i = startIndex; i < endIndex; i++) {
      if (i > 0) {
        const separator = document.createElement('div');
        separator.className = 'json-item-separator';
        container.appendChild(separator);
      }

      const itemContainer = document.createElement('div');
      itemContainer.className = 'json-item';

      // Add item header for arrays
      if (isArray && items.length > 1) {
        const header = document.createElement('div');
        header.className = 'json-item-header';
        header.textContent = `Item ${i + 1}`;
        itemContainer.appendChild(header);
      }

      const pre = document.createElement('pre');
      pre.className = 'json-content';
      // Use path-aware rendering for standard view
      pre.appendChild(renderJSONWithPaths(items[i], ''));
      itemContainer.appendChild(pre);

      container.appendChild(itemContainer);
    }

    return endIndex;
  }

  /**
   * Render JSON with path tracking for standard view
   * Creates a DOM tree with data-json-path attributes
   */
  function renderJSONWithPaths(value, currentPath, indent = 0) {
    const fragment = document.createDocumentFragment();
    const indentStr = '  '.repeat(indent);
    const valueType = getJSONValueType(value);

    if (valueType === 'object') {
      const keys = Object.keys(value);
      fragment.appendChild(document.createTextNode('{\n'));

      keys.forEach((key, idx) => {
        const childPath = currentPath + `['${key}']`;

        // Indentation
        fragment.appendChild(document.createTextNode(indentStr + '  '));

        // Key
        const keySpan = document.createElement('span');
        keySpan.className = 'json-key json-path-item';
        keySpan.dataset.jsonPath = childPath;
        keySpan.dataset.jsonValueType = getJSONValueType(value[key]);
        keySpan.textContent = `"${key}"`;
        fragment.appendChild(keySpan);

        fragment.appendChild(document.createTextNode(': '));

        // Value
        fragment.appendChild(renderJSONWithPaths(value[key], childPath, indent + 1));

        // Comma and newline
        if (idx < keys.length - 1) {
          fragment.appendChild(document.createTextNode(','));
        }
        fragment.appendChild(document.createTextNode('\n'));
      });

      fragment.appendChild(document.createTextNode(indentStr + '}'));
    } else if (valueType === 'array') {
      fragment.appendChild(document.createTextNode('[\n'));

      value.forEach((item, idx) => {
        const childPath = currentPath + `[${idx}]`;

        // Indentation
        fragment.appendChild(document.createTextNode(indentStr + '  '));

        // Value (with path)
        const valueWrapper = document.createElement('span');
        valueWrapper.className = 'json-array-item json-path-item';
        valueWrapper.dataset.jsonPath = childPath;
        valueWrapper.dataset.jsonValueType = getJSONValueType(item);
        valueWrapper.appendChild(renderJSONWithPaths(item, childPath, indent + 1));
        fragment.appendChild(valueWrapper);

        // Comma and newline
        if (idx < value.length - 1) {
          fragment.appendChild(document.createTextNode(','));
        }
        fragment.appendChild(document.createTextNode('\n'));
      });

      fragment.appendChild(document.createTextNode(indentStr + ']'));
    } else {
      // Primitive value
      const valueSpan = document.createElement('span');
      valueSpan.className = `json-${valueType} json-path-item`;
      if (currentPath) {
        valueSpan.dataset.jsonPath = currentPath;
        valueSpan.dataset.jsonValueType = valueType;
      }

      if (valueType === 'string') {
        valueSpan.textContent = `"${value}"`;
      } else if (valueType === 'null') {
        valueSpan.textContent = 'null';
      } else {
        valueSpan.textContent = String(value);
      }

      fragment.appendChild(valueSpan);
    }

    return fragment;
  }

  /**
   * Render JSON in collapsed/tree view
   */
  function renderJSONCollapsedView(parsed, messagesPerBatch) {
    const viewerPanel = document.getElementById('hl7bViewerPanel');
    if (!viewerPanel) return;

    const container = document.createElement('div');
    container.className = 'hl7-container json-collapsed-view';

    const items = getJSONItems(parsed);
    const isArray = Array.isArray(parsed);

    let renderedCount = 0;
    const totalItems = items.length;

    // Render first batch
    renderedCount = renderJSONCollapsedBatch(container, items, 0, messagesPerBatch, isArray);

    // Place content in viewer panel
    viewerPanel.innerHTML = '';
    viewerPanel.appendChild(container);

    // Add "Load More" button if there are more items
    if (renderedCount < totalItems) {
      const loadMoreBtn = createLoadMoreButton(totalItems, renderedCount);
      container.appendChild(loadMoreBtn);

      loadMoreBtn.addEventListener('click', function() {
        loadMoreBtn.remove();
        const newCount = renderJSONCollapsedBatch(container, items, renderedCount, messagesPerBatch, isArray);
        renderedCount = newCount;

        if (renderedCount < totalItems) {
          updateLoadMoreButton(loadMoreBtn, totalItems, renderedCount);
          container.appendChild(loadMoreBtn);
        }
      });
    }

    // Setup expand/collapse listeners (reuse HL7's)
    setupCollapseListeners();

    // Setup JSON context menu for Python path copying
    setupJSONContextMenu();
  }

  /**
   * Render a batch of JSON items in collapsed view
   */
  function renderJSONCollapsedBatch(container, items, startIndex, batchSize, isArray) {
    const endIndex = Math.min(startIndex + batchSize, items.length);

    for (let i = startIndex; i < endIndex; i++) {
      const itemNode = createJSONTreeNode(items[i], isArray ? `[${i}]` : 'root', i, isArray);
      container.appendChild(itemNode);
    }

    return endIndex;
  }

  /**
   * Create a tree node for JSON collapsed view
   */
  function createJSONTreeNode(value, key, index, isArrayItem, parentPath = '') {
    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'json-tree-node';

    const valueType = getJSONValueType(value);
    const isExpandable = valueType === 'object' || valueType === 'array';

    // Build the Python path for this node
    let currentPath;
    if (parentPath === '' && key === 'root') {
      currentPath = '';
    } else if (parentPath === '' && key.startsWith('[')) {
      currentPath = key;
    } else if (parentPath === '') {
      currentPath = `['${key}']`;
    } else if (key.startsWith('[')) {
      currentPath = parentPath + key;
    } else {
      currentPath = parentPath + `['${key}']`;
    }

    if (isExpandable) {
      const header = document.createElement('div');
      header.className = 'hl7-tree-header json-tree-header collapsed';

      const childCount = valueType === 'array' ? value.length : Object.keys(value).length;
      const typeLabel = valueType === 'array' ? `Array[${childCount}]` : `Object{${childCount}}`;
      const displayKey = isArrayItem ? `Item ${index + 1}` : key;

      if (currentPath) {
        header.dataset.jsonPath = currentPath;
        header.dataset.jsonValueType = valueType;
      }

      header.innerHTML = `
        <span class="hl7-tree-toggle">&#9654;</span>
        <span class="json-tree-key">${escapeHtml(displayKey)}</span>
        <span class="json-tree-type">${typeLabel}</span>
      `;
      nodeDiv.appendChild(header);

      const content = document.createElement('div');
      content.className = 'hl7-tree-content';
      content.style.display = 'none';

      const pathForChildren = currentPath || '';

      if (valueType === 'array') {
        value.forEach((item, idx) => {
          const childNode = createJSONTreeNode(item, `[${idx}]`, idx, false, pathForChildren);
          content.appendChild(childNode);
        });
      } else {
        Object.keys(value).forEach((k, idx) => {
          const childNode = createJSONTreeNode(value[k], k, idx, false, pathForChildren);
          content.appendChild(childNode);
        });
      }

      nodeDiv.appendChild(content);
    } else {
      nodeDiv.className += ' json-tree-leaf';
      const displayValue = formatJSONValue(value, valueType);

      if (currentPath) {
        nodeDiv.dataset.jsonPath = currentPath;
        nodeDiv.dataset.jsonValueType = valueType;
      }

      nodeDiv.innerHTML = `
        <span class="json-tree-key">${escapeHtml(key)}</span>
        <span class="json-tree-value json-${valueType}">${escapeHtml(displayValue)}</span>
      `;
    }

    return nodeDiv;
  }

  /**
   * Get the type of a JSON value
   */
  function getJSONValueType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Format a JSON value for display
   */
  function formatJSONValue(value, type) {
    if (type === 'null') return 'null';
    if (type === 'string') return `"${value}"`;
    if (type === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }

  // ========================================
  // JSON CONTEXT MENU FOR PATH COPYING
  // ========================================

  /**
   * Convert a Python-style JSON path to Java-style method calls
   */
  function convertToJavaPath(pythonPath, valueType) {
    const segmentRegex = /\['([^']+)'\]|\[(\d+)\]/g;
    const segments = [];
    let match;

    while ((match = segmentRegex.exec(pythonPath)) !== null) {
      if (match[1] !== undefined) {
        segments.push({ type: 'key', value: match[1] });
      } else if (match[2] !== undefined) {
        segments.push({ type: 'index', value: parseInt(match[2], 10) });
      }
    }

    if (segments.length === 0) {
      return '';
    }

    const parts = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      const nextSegment = segments[i + 1];

      if (segment.type === 'key') {
        if (isLast) {
          parts.push(getJavaGetter(valueType, segment.value));
        } else if (nextSegment && nextSegment.type === 'index') {
          parts.push(`getJSONArray("${segment.value}")`);
        } else {
          parts.push(`getJSONObject("${segment.value}")`);
        }
      } else if (segment.type === 'index') {
        if (isLast) {
          parts.push(getJavaArrayGetter(valueType, segment.value));
        } else if (nextSegment && nextSegment.type === 'index') {
          parts.push(`getJSONArray(${segment.value})`);
        } else {
          parts.push(`getJSONObject(${segment.value})`);
        }
      }
    }

    return parts.join('.');
  }

  function getJavaGetter(valueType, key) {
    switch (valueType) {
      case 'string': return `getString("${key}")`;
      case 'number': return `getDouble("${key}")`;
      case 'boolean': return `getBoolean("${key}")`;
      case 'object': return `getJSONObject("${key}")`;
      case 'array': return `getJSONArray("${key}")`;
      case 'null': return `get("${key}")`;
      default: return `get("${key}")`;
    }
  }

  function getJavaArrayGetter(valueType, index) {
    switch (valueType) {
      case 'string': return `getString(${index})`;
      case 'number': return `getDouble(${index})`;
      case 'boolean': return `getBoolean(${index})`;
      case 'object': return `getJSONObject(${index})`;
      case 'array': return `getJSONArray(${index})`;
      case 'null': return `get(${index})`;
      default: return `get(${index})`;
    }
  }

  /**
   * Setup custom context menu for JSON elements
   */
  function setupJSONContextMenu() {
    const contextMenu = document.createElement('div');
    contextMenu.className = 'json-context-menu';
    contextMenu.style.display = 'none';
    contextMenu.innerHTML = `
      <div class="json-context-menu-item" data-action="copy-python-path">
        <span class="json-context-menu-icon">&#128203;</span>
        Copy Python path
      </div>
      <div class="json-context-menu-item" data-action="copy-java-path">
        <span class="json-context-menu-icon">&#9749;</span>
        Copy Java path
      </div>
    `;
    document.body.appendChild(contextMenu);

    let currentPath = null;
    let currentValueType = null;

    document.body.addEventListener('contextmenu', function(e) {
      const pathElement = e.target.closest('[data-json-path]');

      if (pathElement) {
        e.preventDefault();
        currentPath = pathElement.dataset.jsonPath;
        currentValueType = pathElement.dataset.jsonValueType || 'object';

        contextMenu.style.left = e.pageX + 'px';
        contextMenu.style.top = e.pageY + 'px';
        contextMenu.style.display = 'block';

        const menuRect = contextMenu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth) {
          contextMenu.style.left = (e.pageX - menuRect.width) + 'px';
        }
        if (menuRect.bottom > window.innerHeight) {
          contextMenu.style.top = (e.pageY - menuRect.height) + 'px';
        }
      }
    });

    contextMenu.addEventListener('click', function(e) {
      const menuItem = e.target.closest('.json-context-menu-item');
      if (menuItem && currentPath) {
        if (menuItem.dataset.action === 'copy-python-path') {
          copyToClipboard(currentPath);
          showCopyNotification('Python path copied to clipboard!');
        } else if (menuItem.dataset.action === 'copy-java-path') {
          const javaPath = convertToJavaPath(currentPath, currentValueType);
          copyToClipboard(javaPath);
          showCopyNotification('Java path copied to clipboard!');
        }
      }
      contextMenu.style.display = 'none';
    });

    document.addEventListener('click', function(e) {
      if (!contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
      }
    });

    document.addEventListener('scroll', function() {
      contextMenu.style.display = 'none';
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        contextMenu.style.display = 'none';
      }
    });
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function(err) {
        fallbackCopyToClipboard(text);
      });
    } else {
      fallbackCopyToClipboard(text);
    }
  }

  function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
    document.body.removeChild(textArea);
  }

  function showCopyNotification(message) {
    const existing = document.querySelector('.json-copy-notification');
    if (existing) {
      existing.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'json-copy-notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(function() {
      notification.classList.add('visible');
    }, 10);

    setTimeout(function() {
      notification.classList.remove('visible');
      setTimeout(function() {
        notification.remove();
      }, 300);
    }, 2000);
  }

})();
