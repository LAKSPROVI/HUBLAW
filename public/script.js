// --- INICIALIZAÇÃO DE BIBLIOTECAS ---
lucide.createIcons();
marked.setOptions({ breaks: true, gfm: true });


// --- REFERÊNCIAS AO DOM ---
const chatView = document.getElementById('chat-view');
const agentView = document.getElementById('agent-view');
const chatContainer = document.getElementById('chat-container');
const inputArea = document.getElementById('input-area');
const toggleAgentModeBtn = document.getElementById('toggle-agent-mode');
const agentModeText = document.getElementById('agent-mode-text');
const addStepBtn = document.getElementById('add-step-btn');
const stepsContainer = document.getElementById('steps-container');
const runAgentBtn = document.getElementById('run-agent-btn');
const initialContext = document.getElementById('initial-context');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const newChatBtn = document.getElementById('new-chat-btn');
const recentChatsList = document.getElementById('recent-chats-list');
const chatTitle = document.getElementById('chat-title');
const fileInput = document.getElementById('file-input');
const uploadContextBtn = document.getElementById('upload-context-btn');
const uploadChatBtn = document.getElementById('upload-chat-btn');


// --- ESTADO DA APLICAÇÃO ---
let chatHistory = [];
let currentChatId = null;
let isAgentMode = false;
let targetTextareaForUpload = null;


// --- FUNÇÕES DE COMUNICAÇÃO COM O BACKEND ---
async function loadAndDisplayChatList() {
    try {
        const response = await fetch('/api/chats');
        const chats = await response.json();
        
        recentChatsList.innerHTML = '';
        if (chats.length === 0) {
            recentChatsList.innerHTML = '<li class="p-2 text-sm text-slate-500">Nenhuma conversa salva.</li>';
            return;
        }
        for (const chat of chats) {
            const listItem = document.createElement('li');
            listItem.className = 'p-2 rounded-lg hover:bg-slate-300 cursor-pointer text-sm truncate';
            listItem.textContent = chat.title;
            listItem.dataset.chatId = chat.id;
            listItem.addEventListener('click', () => loadChat(chat.id));
            recentChatsList.appendChild(listItem);
        }
    } catch (error) { console.error("Erro ao carregar a lista de conversas:", error); }
}

async function loadChat(chatId) {
    try {
        const response = await fetch(`/api/chats/${chatId}`);
        const chat = await response.json();
        
        chatHistory = JSON.parse(chat.history);
        currentChatId = chatId;
        
        if (isAgentMode) toggleView();
        renderChat();
        
        chatTitle.textContent = chat.title;
        chatInput.disabled = false;
        chatInput.placeholder = "Digite sua pergunta aqui...";
        document.querySelectorAll('#recent-chats-list li').forEach(li => {
            li.classList.toggle('active-chat', li.dataset.chatId === chatId);
        });
    } catch (error) { console.error("Erro ao carregar a conversa:", error); }
}

async function fetchFromBackend(history, chatId) {
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: history, chatId: chatId })
        });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const result = await response.json();
        return result; // Retorna o objeto { response, chatId }
    } catch (error) {
        console.error("Erro ao comunicar com o backend:", error);
        return { response: "Desculpe, ocorreu um erro no servidor. Verifique a consola do servidor para mais detalhes." };
    }
}


// --- LÓGICA DE UPLOAD DE FICHEIROS ---
async function handleFileUpload(event) {
    if (!targetTextareaForUpload) return;
    const file = event.target.files[0];
    if (!file) return;
    const originalPlaceholder = targetTextareaForUpload.placeholder;
    targetTextareaForUpload.placeholder = "A processar o ficheiro...";
    targetTextareaForUpload.disabled = true;
    try {
        const extension = file.name.split('.').pop().toLowerCase();
        let text = '';
        switch (extension) {
            case 'txt': text = await file.text(); break;
            case 'docx':
                const ab_docx = await file.arrayBuffer();
                text = (await mammoth.extractRawText({ arrayBuffer: ab_docx })).value;
                break;
            case 'pdf':
                const ab_pdf = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: ab_pdf }).promise;
                let pdfText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const tc = await page.getTextContent();
                    pdfText += tc.items.map(item => item.str).join(' ') + '\n';
                }
                text = pdfText;
                break;
            default: alert('Tipo de ficheiro não suportado.');
        }
        targetTextareaForUpload.value = text;
    } catch (error) {
        console.error('Erro ao processar o ficheiro:', error);
        alert('Ocorreu um erro ao ler o ficheiro.');
    } finally {
        targetTextareaForUpload.placeholder = originalPlaceholder;
        targetTextareaForUpload.disabled = false;
        fileInput.value = '';
    }
}
fileInput.addEventListener('change', handleFileUpload);
uploadContextBtn.addEventListener('click', () => { targetTextareaForUpload = initialContext; fileInput.click(); });
uploadChatBtn.addEventListener('click', () => { targetTextareaForUpload = chatInput; fileInput.click(); });


// --- FUNÇÕES DE UI (INTERFACE) ---
function toggleView() {
    isAgentMode = !isAgentMode;
    chatView.classList.toggle('hidden');
    inputArea.classList.toggle('hidden');
    agentView.classList.toggle('hidden');
    agentModeText.textContent = isAgentMode ? 'Modo Chat' : 'Modo Agente';
}
function createStepElement(index) {
    const stepDiv = document.createElement('div');
    stepDiv.className = 'p-4 border rounded-lg bg-white relative';
    stepDiv.innerHTML = `<label class="block text-sm font-medium text-slate-600">Etapa ${index}</label><textarea class="mt-1 block w-full rounded-md bg-slate-50 border-slate-300 shadow-sm" rows="3" placeholder="Ex: Identifique as partes..."></textarea><button class="remove-step-btn absolute top-2 right-2 p-1 text-slate-400 hover:text-red-600"><i data-lucide="trash-2" class="h-4 w-4"></i></button>`;
    stepsContainer.appendChild(stepDiv);
    lucide.createIcons();
}
function startNewChat() {
    currentChatId = null;
    chatHistory = [];
    if (isAgentMode) toggleView();
    chatContainer.innerHTML = `<div id="welcome-screen" class="text-center h-full flex flex-col justify-center items-center"><h2 class="text-4xl font-bold text-slate-700">Como posso ajudar?</h2><p class="text-slate-500 mt-2">Digite sua pergunta abaixo ou anexe um ficheiro para começar.</p></div>`;
    chatTitle.textContent = 'Nova Conversa';
    chatInput.disabled = false;
    chatInput.placeholder = "Digite sua pergunta aqui...";
    chatInput.focus();
    document.querySelectorAll('#recent-chats-list li').forEach(li => li.classList.remove('active-chat'));
}
function renderChat() {
    chatContainer.innerHTML = '';
    chatHistory.forEach(message => {
        addMessageToUI(message.role === 'user' ? 'user' : 'model', message.parts[0].text);
    });
}
function addMessageToUI(sender, message, type = 'chat') {
    const welcomeScreen = document.getElementById('welcome-screen');
    if (welcomeScreen) welcomeScreen.remove();
    const messageWrapper = document.createElement('div');
    const formattedMessage = marked.parse(message);
    if (type === 'step-header') {
        messageWrapper.innerHTML = `<div class="my-4"><h3 class="text-lg font-semibold text-blue-600">${message}</h3></div>`;
    } else if (type === 'step-result') {
        messageWrapper.innerHTML = `<div class="p-4 bg-slate-50 rounded-lg">${formattedMessage}</div>`;
    } else {
         messageWrapper.className = `flex items-start gap-4 ${sender === 'user' ? 'justify-end' : ''}`;
         const avatar = `<div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white ${sender === 'user' ? 'bg-slate-800' : 'bg-blue-600'}">${sender === 'user' ? 'U' : 'IA'}</div>`;
         const content = `<div class="p-4 rounded-lg max-w-xl ${sender === 'user' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-800'}">${formattedMessage}</div>`;
         messageWrapper.innerHTML = sender === 'user' ? `${content}${avatar}` : `${avatar}${content}`;
    }
    chatContainer.appendChild(messageWrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}
function showTypingIndicator(show) {
    let indicator = document.getElementById('typing-indicator');
    if (show) {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'typing-indicator';
            indicator.className = 'flex items-start gap-4';
            indicator.innerHTML = `<div class="w-8 h-8 rounded-full flex-shrink-0 bg-blue-600 flex items-center justify-center font-bold text-white">IA</div><div class="p-4 rounded-lg bg-slate-100"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
            chatContainer.appendChild(indicator);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    } else {
        if (indicator) indicator.remove();
    }
}


// --- LÓGICA PRINCIPAL DE EXECUÇÃO ---
async function runAgent() {
    const context = initialContext.value.trim();
    const steps = Array.from(stepsContainer.querySelectorAll('textarea')).map(el => el.value.trim()).filter(Boolean);
    if (!context || steps.length === 0) {
        alert("Por favor, forneça um contexto inicial e pelo menos uma etapa.");
        return;
    }
    runAgentBtn.disabled = true;
    toggleView();
    currentChatId = null;
    chatHistory = [];
    chatContainer.innerHTML = '';
    const contextPrompt = `**Contexto Inicial Fornecido:**\n\n>${context.replace(/\n/g, '\n>')}\n\n---`;
    addMessageToUI('user', contextPrompt);
    chatHistory.push({ role: "user", parts: [{ text: contextPrompt }] });
    for (let i = 0; i < steps.length; i++) {
        const stepPrompt = steps[i];
        addMessageToUI('system', `Executando Etapa ${i + 1}/${steps.length}: ${stepPrompt}`, 'step-header');
        chatHistory.push({ role: "user", parts: [{ text: stepPrompt }] });
        showTypingIndicator(true);
        const result = await fetchFromBackend(chatHistory, currentChatId);
        showTypingIndicator(false);
        if (result.response) {
            currentChatId = result.chatId;
            chatHistory.push({ role: "model", parts: [{ text: result.response }] });
            addMessageToUI('model', result.response, 'step-result');
        } else {
            addMessageToUI('model', 'Erro na etapa.', 'step-result');
            break; 
        }
    }
    addMessageToUI('system', '✅ Agente concluiu todas as etapas.', 'step-header');
    await loadAndDisplayChatList();
    runAgentBtn.disabled = false;
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userInput = chatInput.value.trim();
    if (!userInput) return;

    addMessageToUI('user', userInput);
    chatHistory.push({ role: "user", parts: [{ text: userInput }] });
    chatInput.value = '';
    sendButton.disabled = true;
    showTypingIndicator(true);
    const result = await fetchFromBackend(chatHistory, currentChatId);
    showTypingIndicator(false);
    
    if (result.response) {
        currentChatId = result.chatId;
        addMessageToUI('model', result.response);
        chatHistory.push({ role: "model", parts: [{ text: result.response }] });
    } else {
        addMessageToUI('model', 'Erro ao obter resposta.');
    }
    
    if (chatHistory.length === 2) {
        await loadAndDisplayChatList();
    }
});


// --- EVENT LISTENERS ---
newChatBtn.addEventListener('click', startNewChat);
toggleAgentModeBtn.addEventListener('click', toggleView);
addStepBtn.addEventListener('click', () => createStepElement(stepsContainer.children.length + 1));
runAgentBtn.addEventListener('click', runAgent);
stepsContainer.addEventListener('click', (e) => {
    if (e.target.closest('.remove-step-btn')) {
        e.target.closest('.p-4').remove();
    }
});
chatInput.addEventListener('input', () => {
    sendButton.disabled = chatInput.value.trim().length === 0;
});


// --- INICIALIZAÇÃO DA APLICAÇÃO ---
window.addEventListener('load', () => {
    loadAndDisplayChatList();
    startNewChat(); // CORREÇÃO: Inicia uma nova conversa ao carregar a página
    createStepElement(1);
});
