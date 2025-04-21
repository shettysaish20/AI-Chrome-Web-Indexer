# Chrome Web Indexer

## Overview
The Chrome Web Indexer is an AI-powered Chrome Extension that indexes every webpage you visit. It leverages Retrieval-Augmented Generation (RAG) on top of the Gemini API (a Large Language Model) to answer questions based on your browsing history. Additionally, it provides functionality to click on source links and view highlighted text used by the LLM as a reference.

## Features
- **Web Page Indexing**: Automatically indexes the content of every webpage you visit.
- **Semantic Search**: Perform powerful semantic searches on your browsing history using embeddings.
- **Chat Functionality**: Ask questions about your browsing history and get concise, AI-generated answers with sources.
- **Source Highlighting**: Click on source links to view highlighted text that was used as a reference by the LLM.
- **Confidentiality Handling**: Skips indexing of confidential or sensitive pages (e.g., Gmail, banking sites).

## Workflow

### 1. Chrome Extension
The Chrome extension consists of the following components:
- **Popup Interface**: Provides a user-friendly interface for search and chat functionalities.
  - `popup.html`: Defines the structure of the popup UI.
  - `popup.css`: Styles the popup interface.
  - `popup.js`: Handles user interactions, API communication, and result display.
- **Content Script**: Extracts page content and handles text highlighting.
  - `content.js`: Runs in the context of web pages to extract content and highlight text.
- **Background Script**: Manages communication between the popup, content scripts, and backend.
  - `background.js`: Handles indexing requests, search queries, and navigation to sources.

### 2. Backend
The backend is a Flask API that processes and indexes web page content, provides search functionality, and integrates with the Gemini API for chat responses.

#### Key Components
- **Perception**: Extracts and processes web page content.
  - `perception.py`: Cleans content, checks for confidentiality, and splits text into chunks for embedding.
- **Memory**: Manages the vector database for storing and retrieving indexed content.
  - `memory.py`: Uses FAISS for vector similarity search and Nomic embeddings for text representation.
- **Decision**: Processes search results and determines the most relevant content.
  - `decision.py`: Extracts highlight terms and creates action plans for search results.
- **Action**: Prepares search results for display and highlighting.
  - `action.py`: Finds highlight positions and generates snippets for search results.
- **Chat**: Integrates with the Gemini API to generate AI-powered responses.
  - `chat.py`: Builds context from search results and generates concise answers with sources.
- **API Endpoints**:
  - `/index`: Receives web page content from the extension and indexes it.
  - `/search`: Searches for content in the index.
  - `/chat`: Generates chat responses using Gemini and indexed content.
  - `/stats`: Provides statistics about the indexed content.
  - `/clear`: Clears the index (for testing or development).

### 3. Workflow
1. **Indexing**:
   - The content script extracts text from web pages and sends it to the backend via the background script.
   - The backend processes the content, checks for confidentiality, and indexes it using FAISS.
2. **Search**:
   - Users can perform semantic searches via the popup interface.
   - The backend retrieves relevant results from the FAISS index and prepares them for display.
3. **Chat**:
   - Users can ask questions about their browsing history.
   - The backend uses the Gemini API to generate responses based on indexed content.
4. **Source Highlighting**:
   - Users can click on source links to view highlighted text on the original webpage.

## Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd chrome-web-indexer
   ```
2. Install dependencies for the backend:
   ```bash
   pip install -r backend/requirements.txt
   ```
3. Start the Flask backend:
   ```bash
   python backend/app.py
   ```
4. Load the Chrome extension:
   - Open Chrome and navigate to `chrome://extensions/`.
   - Enable "Developer mode".
   - Click "Load unpacked" and select the `chrome-web-indexer/chrome-extension` folder.

## Usage
1. Open the Chrome extension popup.
2. Use the **Search** tab to perform semantic searches on your browsing history.
3. Use the **Chat** tab to ask questions about your browsing history.
4. Click on source links in search or chat results to view highlighted text on the original webpage.

## Technologies Used
- **Frontend**: HTML, CSS, JavaScript (Chrome Extension APIs)
- **Backend**: Python, Flask, FAISS, Nomic embeddings, Gemini API
- **Database**: FAISS for vector similarity search

## Contributing
Contributions are welcome! Please fork the repository and submit a pull request with your changes.

## License
This project is licensed under the MIT License. See the `LICENSE` file for details.