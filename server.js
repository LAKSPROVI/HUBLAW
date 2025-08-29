// Importação dos módulos necessários
const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { executeAgent } = require('./agent-logic.js');
require('dotenv').config(); // Para carregar a chave de API de forma segura

// Configuração inicial
const app = express();
const port = 3000; // A porta onde o nosso backend vai correr
let db;

// Validação da Chave de API
if (!process.env.GEMINI_API_KEY) {
    console.error("ERRO: A variável de ambiente GEMINI_API_KEY não está definida.");
    process.exit(1); // Encerra a aplicação se a chave não for encontrada
}

// Configuração da API do Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

// Middlewares - Funções que preparam os pedidos
app.use(express.json()); // Para conseguir ler o corpo dos pedidos em JSON
app.use(express.static(path.join(__dirname, 'public'))); // Para servir os ficheiros estáticos (HTML, CSS, JS do frontend)

// --- ROTAS DA API ---

// Rota para obter a lista de todas as conversas
app.get('/api/chats', async (req, res) => {
    try {
        const chats = await db.all('SELECT id, title, type, status FROM chats ORDER BY id DESC');
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

// Rota para iniciar a execução de um agente
app.post('/api/agent/run', async (req, res) => {
    const { context, steps } = req.body;

    if (!context || !steps || steps.length === 0) {
        return res.status(400).json({ error: 'Contexto e pelo menos uma etapa são obrigatórios.' });
    }

    try {
        const title = `Agente: ${steps[0].substring(0, 50)}...`;
        // Começa com um histórico vazio, que será preenchido pelo agente
        const initialHistory = JSON.stringify([]);

        const result = await db.run(
            "INSERT INTO chats (title, history, type, status) VALUES (?, ?, 'agent', 'running')",
            [title, initialHistory]
        );
        const chatId = result.lastID;

        // Inicia a execução em segundo plano (NÃO USAR AWAIT)
        executeAgent(chatId, context, steps, db, model);

        // Responde imediatamente ao cliente
        res.status(202).json({ chatId });

    } catch (error) {
        console.error('Erro ao iniciar o agente:', error);
        res.status(500).json({ error: 'Ocorreu um erro no servidor ao iniciar o agente.' });
    }
});


// Rota principal para interagir com a IA
app.post('/api/chat', async (req, res) => {
    const { history } = req.body;
    let { chatId } = req.body;

    if (!history || history.length === 0) {
        return res.status(400).json({ error: 'O histórico da conversa é obrigatório.' });
    }

    try {
        // Converte o histórico para o formato que a API do Gemini espera
        const geminiHistory = history.map(msg => ({
            role: msg.role === 'model' ? 'model' : 'user', // Garante que os papéis são 'user' ou 'model'
            parts: msg.parts.map(part => ({text: part.text}))
        }));
        
        const lastMessage = geminiHistory.pop();
        
        const chatSession = model.startChat({
            history: geminiHistory
        });

        const result = await chatSession.sendMessage(lastMessage.parts[0].text);
        const response = result.response;
        const aiText = response.text();

        history.push({ role: 'model', parts: [{ text: aiText }] });

        const title = history[0].parts[0].text.substring(0, 100);
        const historyJson = JSON.stringify(history);

        if (chatId) {
            await db.run('UPDATE chats SET history = ?, title = ? WHERE id = ?', [historyJson, title, chatId]);
        } else {
            const result = await db.run('INSERT INTO chats (title, history) VALUES (?, ?)', [title, historyJson]);
            chatId = result.lastID;
        }

        res.json({ response: aiText, chatId: chatId });

    } catch (error) {
        console.error('Erro ao chamar a API Gemini ou ao salvar no DB:', error);
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
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            type TEXT DEFAULT 'chat' NOT NULL,
            status TEXT
        )
    `);

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    app.listen(port, () => {
        console.log(`Servidor a correr em http://localhost:${port}`);
    });
}

startServer();
