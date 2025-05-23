/**
 * popup.js - JavaScript for the Web Page Indexer popup interface
 * Handles search functionality, API status, and result display
 */

document.addEventListener('DOMContentLoaded', () => {
  // Get UI elements - Search tab
  const searchInput = document.getElementById('search-input');
  const searchButton = document.getElementById('search-button');
  const autoHighlightCheckbox = document.getElementById('auto-highlight');
  const resultsListElement = document.getElementById('results-list');
  const noResultsElement = document.getElementById('no-results');
  const loadingElement = document.getElementById('loading');
  const errorMessageElement = document.getElementById('error-message');
  
  // Get UI elements - Common
  const apiStatusDot = document.getElementById('api-status');
  const statusText = document.getElementById('status-text');
  const indexedPagesElement = document.getElementById('indexed-pages');
  const indexedChunksElement = document.getElementById('indexed-chunks');
  const refreshStatsButton = document.getElementById('refresh-stats');
  
  // Get UI elements - Tabs
  const searchTab = document.getElementById('search-tab');
  const chatTab = document.getElementById('chat-tab');
  const searchTabContent = document.getElementById('search-tab-content');
  const chatTabContent = document.getElementById('chat-tab-content');
  
  // Get UI elements - Chat tab
  const chatMessagesContainer = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSendButton = document.getElementById('chat-send-button');

  // State variables
  const chatHistory = [];
  let isGeneratingResponse = false;
  
  // Check API status when popup opens
  checkApiStatus();
  
  // Load stats when popup opens
  loadStats();
  
  // Set up tab event listeners
  searchTab.addEventListener('click', () => switchTab('search'));
  chatTab.addEventListener('click', () => switchTab('chat'));
  
  // Set up search event listeners
  searchButton.addEventListener('click', performSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });
  refreshStatsButton.addEventListener('click', loadStats);
  
  // Set up chat event listeners
  chatSendButton.addEventListener('click', sendChatMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });
  
  // Switch between tabs
  function switchTab(tabId) {
    // Hide all tab contents
    searchTabContent.classList.remove('active');
    chatTabContent.classList.remove('active');
    
    // Deactivate all tab buttons
    searchTab.classList.remove('active');
    chatTab.classList.remove('active');
    
    // Show selected tab content and activate button
    if (tabId === 'search') {
      searchTabContent.classList.add('active');
      searchTab.classList.add('active');
      setTimeout(() => searchInput.focus(), 100);
    } else if (tabId === 'chat') {
      chatTabContent.classList.add('active');
      chatTab.classList.add('active');
      setTimeout(() => chatInput.focus(), 100);
    }
  }

  // Check if Flask API is running
  async function checkApiStatus() {
    try {
      showStatus('Checking API connection...', 'offline');
      
      const response = await sendMessageToBackground({ action: 'getStats' });
      
      if (response.error) {
        showStatus('API offline', 'offline');
        throw new Error(response.error);
      } else {
        showStatus('API online', 'online');
        updateStatsDisplay(response.stats);
      }
    } catch (error) {
      showStatus('API offline', 'offline');
      console.error('Error checking API:', error);
    }
  }
  
  // Show API status in the UI
  function showStatus(message, statusClass) {
    statusText.textContent = message;
    apiStatusDot.className = 'status-dot ' + statusClass;
  }

  // Load indexing statistics
  async function loadStats() {
    try {
      const response = await sendMessageToBackground({ action: 'getStats' });
      
      if (response.error) {
        console.error('Error loading stats:', response.error);
        return;
      }
      
      updateStatsDisplay(response.stats);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }
  
  // Update statistics display
  function updateStatsDisplay(stats) {
    if (!stats) return;
    
    indexedPagesElement.textContent = stats.total_documents || 0;
    indexedChunksElement.textContent = stats.total_chunks || 0;
  }

  // ======= SEARCH FUNCTIONALITY =======
  
  // Perform search and display results
  async function performSearch() {
    const query = searchInput.value.trim();
    
    if (!query) {
      return;
    }
    
    // Show loading state
    showLoading(true);
    hideResults();
    hideError();
    
    try {
      const response = await sendMessageToBackground({
        action: 'search',
        query: query
      });
      
      if (response.error) {
        showError(response.error);
        return;
      }
      
      displayResults(response.results || []);
    } catch (error) {
      showError('Error performing search: ' + error.message);
    } finally {
      showLoading(false);
    }
  }
  
  // Display search results in the UI
  function displayResults(results) {
    resultsListElement.innerHTML = '';
    
    if (results.length === 0) {
      showNoResults();
      return;
    }
    
    results.forEach(result => {
      const resultItem = document.createElement('div');
      resultItem.className = 'result-item';
      resultItem.dataset.url = result.url;
      resultItem.dataset.chunkId = result.chunk_id || '';
      
      // Format and highlight the snippet
      let snippet = result.snippet || result.content.substring(0, 200) + '...';
      
      // Add result item content
      resultItem.innerHTML = `
        <div class="result-title">${result.title || 'Untitled'}</div>
        <div class="result-url">${formatUrl(result.url)}</div>
        <div class="result-snippet">${snippet}</div>
      `;
      
      // Add click handler to open the page
      resultItem.addEventListener('click', () => {
        openResultPage(result);
      });
      
      resultsListElement.appendChild(resultItem);
    });
    
    resultsListElement.classList.remove('hidden');
  }
  
  // Open a result page and highlight content if needed
  function openResultPage(result) {
    chrome.tabs.create({ url: result.url }, (tab) => {
      if (autoHighlightCheckbox.checked) {
        // Extract highlight terms from the result
        const highlightTerms = extractHighlightTerms(result);
        
        // Give the page time to load before trying to highlight
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'highlight',
            positions: highlightTerms
          });
        }, 1000);
      }
    });
  }
  
  // Extract highlight terms from a search result
  function extractHighlightTerms(result) {
    const positions = result.highlight_positions || [];
    
    // If no highlight positions are available, extract terms from the query
    if (positions.length === 0) {
      const query = searchInput.value.trim();
      const terms = query.split(/\s+/).filter(term => term.length > 2);
      
      return terms.map(term => ({
        term: term
      }));
    }
    
    return positions;
  }
  
  // ======= CHAT FUNCTIONALITY =======
  
  // Send a chat message
  async function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message || isGeneratingResponse) return;
    
    // Clear input
    chatInput.value = '';
    
    // Add user message to UI
    addMessageToChat(message, 'user');
    
    // Start generating response
    isGeneratingResponse = true;
    showTypingIndicator();
    
    try {
      const response = await sendMessageToBackground({
        action: 'generateChatResponse',
        query: message
      });
      
      // Remove typing indicator
      removeTypingIndicator();
      
      if (response.error) {
        addSystemMessageToChat(`Error: ${response.error}`);
      } else {
        // Add AI response to chat with sources
        addMessageToChat(response.text, 'assistant', response.sources);
      }
    } catch (error) {
      removeTypingIndicator();
      addSystemMessageToChat(`Error: ${error.message}`);
    } finally {
      isGeneratingResponse = false;
    }
  }
  
  // Add a message to the chat UI
  function addMessageToChat(text, sender, sources = []) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${sender}-message`;
    
    // Create and set message text
    const textElement = document.createElement('div');
    textElement.className = 'message-text';
    textElement.textContent = text;
    messageElement.appendChild(textElement);
    
    // If there are sources, add them
    if (sources && sources.length > 0) {
      const sourcesElement = document.createElement('div');
      sourcesElement.className = 'source-links';
      
      // Add a small header for sources
      const sourcesHeader = document.createElement('div');
      sourcesHeader.className = 'sources-header';
      sourcesHeader.textContent = 'Sources:';
      sourcesElement.appendChild(sourcesHeader);
      
      // Add each source
      sources.forEach(source => {
        const sourceLink = document.createElement('div');
        sourceLink.className = 'source-link';
        sourceLink.dataset.url = source.url;
        sourceLink.dataset.chunkId = source.chunk_id || '';
        
        // Create favicon and title elements
        const favicon = document.createElement('img');
        favicon.className = 'source-favicon';
        favicon.src = `https://www.google.com/s2/favicons?domain=${new URL(source.url).hostname}`;
        favicon.onerror = () => {
          favicon.style.display = 'none';
        };
        
        const title = document.createElement('div');
        title.className = 'source-title';
        title.textContent = source.title || formatUrl(source.url);
        
        sourceLink.appendChild(favicon);
        sourceLink.appendChild(title);
        
        // Add click handler to open source
        sourceLink.addEventListener('click', () => openSourcePage(source));
        
        sourcesElement.appendChild(sourceLink);
      });
      
      messageElement.appendChild(sourcesElement);
    }
    
    // Add to chat container and scroll to bottom
    chatMessagesContainer.appendChild(messageElement);
    scrollChatToBottom();
    
    // Store in chat history
    chatHistory.push({
      text,
      sender,
      sources
    });
  }
  
  // Add system message to chat
  function addSystemMessageToChat(text) {
    const systemMessageElement = document.createElement('div');
    systemMessageElement.className = 'system-message';
    systemMessageElement.textContent = text;
    chatMessagesContainer.appendChild(systemMessageElement);
    scrollChatToBottom();
  }
  
  // Show typing indicator
  function showTypingIndicator() {
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'message assistant-message message-typing';
    typingIndicator.id = 'typing-indicator';
    
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'typing-dot';
      typingIndicator.appendChild(dot);
    }
    
    chatMessagesContainer.appendChild(typingIndicator);
    scrollChatToBottom();
  }
  
  // Remove typing indicator
  function removeTypingIndicator() {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) {
      typingIndicator.remove();
    }
  }
  
  // Open source page with improved highlighting
  function openSourcePage(source) {
    // Ensure source has the necessary properties
    if (!source || !source.url) {
      console.error('Invalid source object:', source);
      return;
    }
    
    // Use enhanced data for highlighting
    const highlightData = {
      content: source.content || "",
      snippet: source.snippet || "",
      url: source.url,
      // Add a timestamp to ensure this is treated as a fresh request
      timestamp: Date.now()
    };
    
    // Store in session storage as a backup mechanism
    chrome.storage.session.set({ 'highlightData': highlightData });
    
    // Open the page in a new tab
    chrome.tabs.create({ url: source.url }, (tab) => {
      if (!tab || !tab.id) {
        console.error('Failed to create tab');
        return;
      }
      
      // Wait for a reasonable amount of time for the page to load
      const waitTime = 2000; // 2 seconds
      
      // Set up a retry mechanism
      let retryCount = 0;
      const maxRetries = 3;
      
      function attemptHighlighting() {
        console.log(`Attempting to highlight in tab ${tab.id}, attempt ${retryCount + 1}`);
        
        // Send to background script for highlighting
        chrome.runtime.sendMessage({
          action: 'highlightSource',
          tabId: tab.id,
          source: {
            content: source.content || "",
            snippet: source.snippet || "",
            url: source.url,
            title: source.title || ""
          }
        }, (response) => {
          // Check if highlighting succeeded
          if (!response || response.error || !response.success) {
            console.warn('Highlighting response indicates failure:', response);
            retryCount++;
            
            // If we still have retries left and got an error about content script not being ready,
            // try again after a short delay
            if (retryCount < maxRetries) {
              console.log(`Scheduling retry ${retryCount + 1} in ${1000 * retryCount}ms...`);
              setTimeout(attemptHighlighting, 1000 * retryCount);
            } else {
              console.error('Maximum highlight retries exceeded. Falling back to direct method.');
              // Final fallback - use direct highlighting method
              tryDirectHighlighting();
            }
          }
        });
      }
      
      // Fallback method that sends highlight message directly to the content script
      function tryDirectHighlighting() {
        console.log('Attempting direct highlighting...');
        const terms = extractBetterHighlightTerms(source.snippet || source.content || "");
        
        if (terms.length > 0) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'highlight',
            positions: terms.map(term => ({ term }))
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('Direct highlighting failed:', chrome.runtime.lastError);
            } else {
              console.log('Direct highlighting response:', response);
            }
          });
        }
      }
      
      // Start the highlight process after waiting for page to load
      setTimeout(attemptHighlighting, waitTime);
    });
  }
  
  // Extract better highlight terms from source content with improved logic
  function extractBetterHighlightTerms(content) {
    if (!content || typeof content !== 'string') return [];
    
    // Clean the content - remove excess whitespace
    content = content.trim().replace(/\s+/g, ' ');
    if (content.length < 5) return [];
    
    const result = [];
    
    // Strategy 1: Exact sentences (30-80 chars) - highest quality for highlighting
    const sentences = content.split(/[.!?]+/).map(s => s.trim())
      .filter(s => s.length >= 30 && s.length <= 80);
      
    if (sentences.length > 0) {
      // Add top 2 sentences directly
      result.push(...sentences.slice(0, 2));
    }
    
    // Strategy 2: Distinctive phrases (4-6 consecutive words)
    if (result.length < 3) {
      const words = content.trim().split(/\s+/);
      for (let i = 0; i < words.length - 5 && result.length < 3; i += 5) {
        const phrase = words.slice(i, i + 5).join(' ');
        if (phrase.length >= 20 && phrase.length <= 60) {
          result.push(phrase);
        }
      }
    }
    
    // Strategy 3: Fall back to unusual words or combinations
    if (result.length === 0) {
      // Look for words that are likely to be distinctive
      const distinctiveWords = content.split(/\s+/)
        .filter(word => word.length > 6)
        .filter(word => {
          // Words with mixed case or numbers are likely more distinctive
          return (
            /[A-Z]/.test(word) && /[a-z]/.test(word) || 
            /\d/.test(word) ||
            /[^\w\s]/.test(word)
          );
        });
      
      if (distinctiveWords.length > 0) {
        // Take up to 3 distinctive words
        result.push(...distinctiveWords.slice(0, 3));
      } else if (content.length > 20) {
        // Last resort: take a chunk of content
        result.push(content.substring(0, Math.min(80, content.length)));
      }
    }
    
    console.log("Extracted highlight terms:", result);
    return result.slice(0, 5); // Limit to max 5 terms
  }
  
  // Scroll chat to bottom
  function scrollChatToBottom() {
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
  }
  
  // ======= COMMON FUNCTIONALITY =======
  
  // Send a message to the background script
  function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
      // Attempt to get a long-lived connection to prevent port closure
      const port = chrome.runtime.connect({ name: "popup-port" });
      
      // Set up port error handling
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Connection failed: ${chrome.runtime.lastError.message}`));
        }
      });
      
      // Listen for responses on this port
      port.onMessage.addListener((response) => {
        resolve(response);
        // After receiving the response, we can close the port
        port.disconnect();
      });
      
      // Send the message on the port
      port.postMessage(message);
      
      // Set a timeout to handle long operations
      setTimeout(() => {
        reject(new Error("Operation timed out after 2 minutes. Try a shorter query."));
        port.disconnect();
      }, 120000); // 2 minute timeout
    });
  }
  
  // Format URL for display
  function formatUrl(url) {
    try {
      const urlObj = new URL(url);
      let formatted = urlObj.hostname;
      if (urlObj.pathname !== '/') {
        formatted += urlObj.pathname.length > 20 
          ? urlObj.pathname.substring(0, 20) + '...'
          : urlObj.pathname;
      }
      return formatted;
    } catch (error) {
      return url;
    }
  }
  
  // UI helper functions
  function showLoading(show) {
    loadingElement.classList.toggle('hidden', !show);
  }
  
  function showNoResults() {
    noResultsElement.classList.remove('hidden');
  }
  
  function hideResults() {
    noResultsElement.classList.add('hidden');
    resultsListElement.innerHTML = '';
  }
  
  function showError(message) {
    errorMessageElement.textContent = message;
    errorMessageElement.classList.remove('hidden');
  }
  
  function hideError() {
    errorMessageElement.classList.add('hidden');
  }
});