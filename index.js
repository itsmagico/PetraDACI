require('dotenv').config(); // Adicionado para usar .env localmente

const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});
const prefix = config.prefix;
const botsRunning = new Map();
const usersDataPath = './usersdata.json';

fs.ensureFileSync(usersDataPath);

function gerarSufixo() {
    const numeros = Math.floor(Math.random() * 90 + 10);
    const letra = String.fromCharCode(97 + Math.floor(Math.random() * 26));
    return `${numeros}${letra}`;
}

function salvarUsersData(data) {
    fs.writeJSONSync(usersDataPath, data, { spaces: 4 });
}

function carregarUsersData() {
    return fs.readJSONSync(usersDataPath);
}

function iniciarApp(userId, pasta, comandoExecucao) {
    const [comando, ...parametros] = comandoExecucao.split(' ');
    const proc = spawn(comando, parametros, { cwd: pasta });

    const logs = [];
    proc.stdout.on('data', data => {
        const output = data.toString();
        console.log(`[${userId}] ${output}`);
        logs.push(`[STDOUT] ${output}`);
        if (logs.length > 10) logs.shift();
    });

    proc.stderr.on('data', data => {
        const error = data.toString();
        console.error(`[${userId} ERRO] ${error}`);
        logs.push(`[STDERR] ${error}`);
        if (logs.length > 10) logs.shift();
    });

    proc.on('exit', (code) => {
        console.log(`[${userId}] Aplicação finalizada com código ${code}`);
        botsRunning.delete(userId);
        const usersData = carregarUsersData();
        if (usersData[userId]) {
            usersData[userId].status = 'desligado';
            salvarUsersData(usersData);
        }
    });

    botsRunning.set(userId, { folder: pasta, process: proc, logs: logs });
}

client.once('ready', () => {
    console.log(`☁️ UniCloud conectado como ${client.user.tag}`);
    fs.ensureDirSync('./hospedagem');

    const usersData = carregarUsersData();
    let count = 0;
    for (const userId in usersData) {
        const userInfo = usersData[userId];
        if (userInfo.status === 'rodando') {
            const userFolder = path.join(__dirname, 'hospedagem', userInfo.pasta);
            iniciarApp(userId, userFolder, userInfo.comando);
            console.log(`✅ Reiniciado: ${userId} | Pasta: ${userInfo.pasta} | Comando: ${userInfo.comando}`);
            count++;
        }
    }
    console.log(`🔄 Auto-Restart finalizado. Total de bots reiniciados: ${count}`);
});

client.on('messageCreate', async message => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    if (['up', 'subir', 'sub'].includes(cmd)) {
        const usersData = carregarUsersData();
        if (usersData[message.author.id]) {
            return message.reply('⚠️ **Atenção:** Você já está hospedando uma aplicação.\nUse `u.remove` antes de criar outra.');
        }

        const channel = await message.guild.channels.create({
            name: `unicloud-${message.author.username}`,
            type: 0,
            permissionOverwrites: [
                { id: message.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] }
            ]
        });

        await channel.send('⚙️ **Configuração:** Qual comando usarei para ligar sua aplicação?\n*Exemplo: node index.js*');

        const comandoCol = await channel.awaitMessages({ filter: m => m.author.id === message.author.id, max: 1, time: 60000 });
        if (comandoCol.size === 0) {
            await channel.send('⏰ **Tempo esgotado.** Operação cancelada.');
            return channel.delete();
        }
        const comandoExecucao = comandoCol.first().content.trim();

        await channel.send('📦 **Upload:** Envie agora o arquivo `.zip` da sua aplicação.');

        const zipCol = await channel.awaitMessages({ filter: m => m.author.id === message.author.id && m.attachments.size > 0, max: 1, time: 60000 });
        if (zipCol.size === 0) {
            await channel.send('⏰ **Tempo esgotado.** Operação cancelada.');
            return channel.delete();
        }

        const attachment = zipCol.first().attachments.first();
        const fileUrl = attachment.url;
        const fileName = attachment.name;

        if (!fileName.endsWith('.zip')) {
            await channel.send('❌ **Erro:** O arquivo precisa ser um `.zip`.');
            return channel.delete();
        }

        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());
        const sufixo = gerarSufixo();
        const folderName = `${message.author.username}_${sufixo}`;
        const userFolder = path.join(__dirname, 'hospedagem', folderName);
        fs.ensureDirSync(userFolder);

        const zip = new AdmZip(buffer);
        zip.extractAllTo(userFolder);

        iniciarApp(message.author.id, userFolder, comandoExecucao);

        const usersDataUpdated = carregarUsersData();
        usersDataUpdated[message.author.id] = {
            pasta: folderName,
            comando: comandoExecucao,
            status: 'rodando'
        };
        salvarUsersData(usersDataUpdated);

        await channel.send('✅ **Sucesso:** Sua aplicação foi hospedada e está rodando na **UniCloud**!\nEste canal será excluído.');
        await channel.delete();

        message.reply('✅ **Sua aplicação foi hospedada com sucesso na UniCloud!**');
    }

    else if (cmd === 'stop') {
        const bot = botsRunning.get(message.author.id);
        if (!bot) return message.reply('⚠️ **Você não está rodando nenhuma aplicação no momento.**');

        bot.process.kill();
        botsRunning.delete(message.author.id);

        const usersData = carregarUsersData();
        if (usersData[message.author.id]) {
            usersData[message.author.id].status = 'desligado';
            salvarUsersData(usersData);
        }

        message.reply('🛑 **Sua aplicação foi parada com sucesso.**');
    }

    else if (cmd === 'remove') {
        const usersData = carregarUsersData();

        if (!usersData[message.author.id]) {
            return message.reply('⚠️ **Nenhuma hospedagem encontrada para você.**');
        }

        if (usersData[message.author.id].status === 'rodando') {
            return message.reply('⚠️ **Pare sua aplicação primeiro com `u.stop` antes de remover.**');
        }

        const userFolder = path.join(__dirname, 'hospedagem', usersData[message.author.id].pasta);
        fs.removeSync(userFolder);
        delete usersData[message.author.id];
        salvarUsersData(usersData);

        message.reply('🗑️ **Sua hospedagem foi removida com sucesso.**');
    }

    else if (cmd === 'console') {
        const bot = botsRunning.get(message.author.id);
        if (!bot) return message.reply('⚠️ **Sua aplicação não está ativa no momento.**');

        const output = bot.logs.slice(-5).join('\n');
        message.reply(`🖥️ **Últimas saídas da sua aplicação:**\n\`\`\`\n${output}\n\`\`\``);
    }
});

client.login(process.env.TOKEN); // Modificado para usar variável de ambiente
