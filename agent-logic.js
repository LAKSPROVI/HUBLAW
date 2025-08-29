async function executeAgent(chatId, context, steps, db, model) {
    // 1. Inicializa o histórico com o contexto
    let history = [{ role: "user", parts: [{ text: `**Contexto Inicial Fornecido:**\n\n>${context.replace(/\n/g, '\n>')}\n\n---` }] }];
    let historyJson = JSON.stringify(history);
    await db.run('UPDATE chats SET history = ? WHERE id = ?', [historyJson, chatId]);

    try {
        // 2. Itera sobre cada etapa
        for (const step of steps) {
            history.push({ role: "user", parts: [{ text: step }] });

            const geminiHistory = history.map(msg => ({
                role: msg.role === 'model' ? 'model' : 'user',
                parts: msg.parts.map(part => ({text: part.text}))
            }));
            const lastMessage = geminiHistory.pop();

            const chatSession = model.startChat({ history: geminiHistory });
            const result = await chatSession.sendMessage(lastMessage.parts[0].text);
            const aiText = result.response.text();

            history.push({ role: "model", parts: [{ text: aiText }] });

            historyJson = JSON.stringify(history);
            await db.run('UPDATE chats SET history = ? WHERE id = ?', [historyJson, chatId]);
        }

        // 3. Marca a execução como concluída
        await db.run("UPDATE chats SET status = 'completed' WHERE id = ?", [chatId]);
        console.log(`[Agent Run ${chatId}] Execução concluída com sucesso.`);

    } catch (error) {
        console.error(`[Agent Run ${chatId}] Erro durante a execução:`, error);
        // 4. Marca a execução como falha
        await db.run("UPDATE chats SET status = 'failed' WHERE id = ?", [chatId]);
        // Opcional: Adiciona uma mensagem de erro ao histórico
        history.push({ role: "model", parts: [{ text: `Ocorreu um erro na execução do agente: ${error.message}` }] });
        historyJson = JSON.stringify(history);
        await db.run('UPDATE chats SET history = ? WHERE id = ?', [historyJson, chatId]);
    }
}

module.exports = { executeAgent };
