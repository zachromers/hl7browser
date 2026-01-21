// HL7 Browser - Content Script
// Parses HL7 messages and provides interactive hover tooltips

(function() {
  'use strict';

  // Get the raw text content of the page
  const rawContent = document.body.innerText || document.body.textContent;

  // Check if this looks like HL7 content
  if (!isHL7Content(rawContent)) {
    return; // Not HL7 content, don't modify the page
  }

  // Load view mode setting and render
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.sync.get(['viewMode'], function(result) {
      const viewMode = result.viewMode || 'standard';
      renderHL7Content(rawContent, viewMode);
    });
  } else {
    // Fallback if storage not available
    renderHL7Content(rawContent, 'standard');
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
  function renderHL7Content(content, viewMode) {
    if (viewMode === 'collapsed') {
      renderCollapsedView(content);
    } else {
      renderStandardView(content);
    }
  }

  /**
   * Render the standard inline view with hover tooltips
   */
  function renderStandardView(content) {
    // Create the main container
    const container = document.createElement('div');
    container.className = 'hl7-container hl7-standard-view';

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'hl7-tooltip';
    tooltip.style.display = 'none';

    // Split content into lines
    const lines = content.split(/\r?\n/);

    // Track message context (encoding characters)
    let fieldSeparator = '|';
    let componentSeparator = '^';
    let repetitionSeparator = '~';
    let escapeCharacter = '\\';
    let subcomponentSeparator = '&';

    for (const line of lines) {
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

    // Replace page content
    document.body.innerHTML = '';
    document.body.appendChild(container);
    document.body.appendChild(tooltip);

    // Add event listeners for tooltips
    setupTooltipListeners(tooltip);
  }

  /**
   * Render the collapsed/tree view with expandable segments
   */
  function renderCollapsedView(content) {
    // Create the main container
    const container = document.createElement('div');
    container.className = 'hl7-container hl7-collapsed-view';

    // Split content into lines and parse into messages
    const lines = content.split(/\r?\n/);
    const messages = parseIntoMessages(lines);

    // Render each message as an expandable tree
    messages.forEach((message, msgIndex) => {
      const messageDiv = createMessageNode(message, msgIndex);
      container.appendChild(messageDiv);
    });

    // Replace page content
    document.body.innerHTML = '';
    document.body.appendChild(container);

    // Setup expand/collapse listeners
    setupCollapseListeners();
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
  function createMessageNode(message, msgIndex) {
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

    // Message header
    const messageHeader = document.createElement('div');
    messageHeader.className = 'hl7-tree-header hl7-tree-message-header collapsed';
    messageHeader.innerHTML = `
      <span class="hl7-tree-toggle">&#9654;</span>
      <span class="hl7-tree-icon">&#128232;</span>
      <span class="hl7-tree-title">Message ${msgIndex + 1}: ${escapeHtml(messageType)}</span>
      <span class="hl7-tree-count">${message.segments.length} segments</span>
    `;
    messageDiv.appendChild(messageHeader);

    // Message content (segments)
    const messageContent = document.createElement('div');
    messageContent.className = 'hl7-tree-content';
    messageContent.style.display = 'none';

    message.segments.forEach(segment => {
      const segmentNode = createSegmentNode(segment);
      messageContent.appendChild(segmentNode);
    });

    messageDiv.appendChild(messageContent);

    return messageDiv;
  }

  /**
   * Create a segment node for the collapsed view
   */
  function createSegmentNode(segment) {
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
      // MSH.1 - Field Separator
      const field1Node = createFieldNode(segment.segmentId, 1, segment.fieldSeparator, null, segment.componentSeparator, segment.subcomponentSeparator);
      segmentContent.appendChild(field1Node);

      // MSH.2 - Encoding Characters
      const field2Node = createFieldNode(segment.segmentId, 2, segment.fields[0], null, segment.componentSeparator, segment.subcomponentSeparator);
      segmentContent.appendChild(field2Node);

      // Remaining fields
      for (let i = 1; i < segment.fields.length; i++) {
        const fieldNum = i + 2;
        const fieldNode = createFieldNode(segment.segmentId, fieldNum, segment.fields[i], segmentInfo, segment.componentSeparator, segment.subcomponentSeparator);
        segmentContent.appendChild(fieldNode);
      }
    } else {
      // Regular segment
      for (let i = 0; i < segment.fields.length; i++) {
        const fieldNum = i + 1;
        const fieldNode = createFieldNode(segment.segmentId, fieldNum, segment.fields[i], segmentInfo, segment.componentSeparator, segment.subcomponentSeparator);
        segmentContent.appendChild(fieldNode);
      }
    }

    segmentDiv.appendChild(segmentContent);

    return segmentDiv;
  }

  /**
   * Create a field node for the collapsed view
   */
  function createFieldNode(segmentId, fieldNum, fieldValue, segmentInfo, compSep, subcompSep) {
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
        const compNode = createComponentNode(segmentId, fieldNum, compNum, comp, fieldDef, subcompSep);
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
  function createComponentNode(segmentId, fieldNum, compNum, compValue, fieldDef, subcompSep) {
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
   * Setup expand/collapse click listeners
   */
  function setupCollapseListeners() {
    document.body.addEventListener('click', function(e) {
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
    });
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

})();
