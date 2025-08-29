// Importação dos módulos necessários
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { ChromaClient } = require('chromadb');
require('dotenv').config(); // Para carregar a chave de API de forma segura

// Configuração inicial
const app = express();
const port = 3000; // A porta onde o nosso backend vai correr
let db;
let aichat_collection; // Coleção do ChromaDB para a memória do chat

// Validação da Chave de API
if (!process.env.GEMINI_API_KEY) {
    console.error("ERRO: A variável de ambiente GEMINI_API_KEY não está definida.");
    process.exit(1); // Encerra a aplicação se a chave não for encontrada
}

// Configuração da API do Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// --- FUNÇÕES AUXILIARES PARA MEMÓRIA VETORIAL ---

/**
 * Divide um texto em pedaços menores com uma sobreposição.
 * @param {string} text O texto a ser dividido.
 * @param {number} chunkSize O tamanho de cada pedaço.
 * @param {number} overlap A sobreposição entre os pedaços.
 * @returns {string[]} Um array de pedaços de texto.
 */
function chunkText(text, chunkSize = 1000, overlap = 100) {
    const chunks = [];
    if (!text) return chunks;
    let i = 0;
    while (i < text.length) {
        chunks.push(text.substring(i, i + chunkSize));
        i += chunkSize - overlap;
    }
    return chunks;
}

/**
 * Adiciona uma mensagem à memória vetorial (ChromaDB).
 * @param {string|number} chatId O ID da conversa.
 * @param {{role: string, parts: {text: string}[]}} message O objeto da mensagem.
 */
async function addMessageToMemory(chatId, message) {
    if (!aichat_collection) {
        console.error("A coleção do ChromaDB não foi inicializada.");
        return;
    }

    const text = message.parts[0].text;
    const role = message.role;

    // 1. Dividir o texto em pedaços (chunks)
    const chunks = chunkText(text);
    if (chunks.length === 0) return;

    // 2. Gerar embeddings para cada pedaço
    const embeddings = [];
    for (const chunk of chunks) {
        try {
            const result = await embeddingModel.embedContent({
                content: { parts: [{ text: chunk }] },
                task_type: "RETRIEVAL_DOCUMENT"
            });
            embeddings.push(result.embedding.values);
        } catch (error) {
            console.error("Erro ao gerar embedding para o chunk:", error);
            // Pular este chunk se houver erro
            return;
        }
    }

    // 3. Preparar dados para o ChromaDB
    // Gera IDs únicos para cada chunk para evitar colisões
    const ids = chunks.map((_, index) => `chat_${chatId}_${role}_${Date.now()}_${index}`);
    const metadatas = chunks.map(() => ({
        role: role,
        chatId: String(chatId),
        timestamp: Date.now()
    }));

    // 4. Adicionar à coleção do ChromaDB
    try {
        await aichat_collection.add({
            ids: ids,
            embeddings: embeddings,
            metadatas: metadatas,
            documents: chunks
        });
        console.log(`Adicionados ${chunks.length} chunks à memória para o chat ${chatId}.`);
    } catch (error) {
        console.error("Erro ao adicionar chunks ao ChromaDB:", error);
    }
}

/**
 * Recupera o contexto relevante do ChromaDB para uma determinada consulta.
 * @param {string|number} chatId O ID da conversa para filtrar a busca.
 * @param {string} queryText O texto da consulta do usuário.
 * @param {number} nResults O número de resultados a serem recuperados.
 * @returns {Promise<string>} Uma string contendo o contexto recuperado.
 */
async function retrieveContext(chatId, queryText, nResults = 5) {
    if (!aichat_collection) {
        console.error("A coleção do ChromaDB não foi inicializada.");
        return "";
    }

    try {
        // 1. Gerar embedding para a consulta do usuário
        const queryEmbedding = await embeddingModel.embedContent({
            content: { parts: [{ text: queryText }] },
            task_type: "RETRIEVAL_QUERY"
        });

        // 2. Consultar o ChromaDB por chunks relevantes, filtrando pelo chatId
        const results = await aichat_collection.query({
            queryEmbeddings: [queryEmbedding.embedding.values],
            nResults: nResults,
            where: { chatId: String(chatId) }
        });

        // 3. Formatar e retornar o contexto
        if (results.documents && results.documents.length > 0 && results.documents[0].length > 0) {
            const context = results.documents[0].join("\n\n---\n\n");
            console.log(`Contexto recuperado para o chat ${chatId}.`);
            return context;
        }
        console.log("Nenhum contexto relevante encontrado.");
        return "";

    } catch (error) {
        console.error("Erro ao consultar o ChromaDB:", error);
        return "";
    }
}


// Middlewares - Funções que preparam os pedidos
// Aumenta o limite do corpo da requisição para 50mb para permitir o upload de ficheiros
app.use(express.json({ limit: '50mb' })); // Para conseguir ler o corpo dos pedidos em JSON
app.use(express.static(path.join(__dirname, 'public'))); // Para servir os ficheiros estáticos (HTML, CSS, JS do frontend)

// --- ROTAS DA API ---

// Rota para obter a lista de todas as conversas
app.get('/api/chats', async (req, res) => {
    try {
        const chats = await db.all('SELECT id, title FROM chats ORDER BY id DESC');
        res.json(chats);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar conversas.' });
    }
});

// Rota para obter uma conversa específica pelo ID
app.get('/api/chats/:id', async (req, res) => {
    try {
        const chat = await db.get('SELECT * FROM chats WHERE id = ?', [req.params.id]);
        if (chat) {
            res.json(chat);
        } else {
            res.status(404).json({ error: 'Conversa não encontrada.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar a conversa.' });
    }
});

// Rota principal para interagir com a IA (agora com RAG)
app.post('/api/chat', async (req, res) => {
    const { history } = req.body;
    let { chatId } = req.body;

    if (!history || history.length === 0) {
        return res.status(400).json({ error: 'O histórico da conversa é obrigatório.' });
    }

    const userMessage = history[history.length - 1];
    const userQuery = userMessage.parts[0].text;

    try {
        // 1. Recuperar contexto relevante se a conversa já existir
        let context = "";
        if (chatId) {
            context = await retrieveContext(chatId, userQuery);
        }

        // 2. Construir o prompt aumentado
        const augmentedPrompt = `
Por favor, aja como um assistente jurídico prestativo.
Use o seguinte CONTEXTO de partes anteriores desta conversa para informar sua resposta.
Se o contexto não for relevante, ignore-o e responda à PERGUNTA do usuário da melhor forma possível.

---
CONTEXTO:
${context || "Nenhum contexto relevante encontrado."}
---

PERGUNTA:
${userQuery}
`;

        // 3. Chamar a IA com o prompt aumentado
        const result = await model.generateContent(augmentedPrompt);
        const response = result.response;
        const aiText = response.text();
        const aiMessage = { role: 'model', parts: [{ text: aiText }] };

        // 4. Atualizar o histórico da conversa para salvar no BD
        history.push(aiMessage);
        const historyJson = JSON.stringify(history);

        // 5. Salvar no banco de dados (SQLite)
        if (chatId) {
            await db.run('UPDATE chats SET history = ? WHERE id = ?', [historyJson, chatId]);
        } else {
            const title = userQuery.substring(0, 100);
            const insertResult = await db.run('INSERT INTO chats (title, history) VALUES (?, ?)', [title, historyJson]);
            chatId = insertResult.lastID;
        }

        // 6. Adicionar a nova troca (pergunta e resposta) à memória vetorial
        await addMessageToMemory(chatId, userMessage);
        await addMessageToMemory(chatId, aiMessage);

        // 7. Enviar a resposta de volta ao cliente
        res.json({ response: aiText, chatId: chatId });

    } catch (error) {
        console.error('Erro no fluxo de RAG ou ao salvar no DB:', error);
        res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
    }
});


// --- INICIALIZAÇÃO DO SERVIDOR E BANCO DE DADOS ---
async function startServer() {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            history TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Inicializa o cliente do ChromaDB e a coleção
    console.log("Inicializando o ChromaDB...");
    const chroma_client = new ChromaClient();
    aichat_collection = await chroma_client.getOrCreateCollection({ name: "chat_memory" });
    console.log("Coleção 'chat_memory' carregada.");

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.listen(port, () => {
        console.log(`Servidor a correr em http://localhost:${port}`);
    });
}

startServer();
