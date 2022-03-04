import { states, createServer, createClient, Client, ServerClient, ServerOptions } from 'minecraft-protocol'
import * as json5 from 'json5'
import { readFileSync } from 'node:fs'

const connectionOptions = {
    host: "localhost",
    port: 25565,
    version: "1.18.1",
}

const ChatMessage = require('prismarine-chat')(connectionOptions.version)
const { MessageBuilder } = require('prismarine-chat')(connectionOptions.version)
const mcData = require('minecraft-data')(connectionOptions.version)

console.log("starting proxy instance...");

const server_options: ServerOptions = {
    host: "0.0.0.0",
    keepAlive: false,
    version: "1.18.1",
    maxPlayers: 1,
    beforePing: function (response, client) {
        response.players.online = Math.floor(Math.random() * 1000);
        response.players.max = Math.floor(Math.random() * 1000);
    }
}

const offline_server = createServer({
    ...server_options,
    port: 25566,
    motd: "reverse proxy for offline auth",
    'online-mode': false,
})

const online_server = createServer({
    ...server_options,
    port: 25567,
    motd: "reverse proxy for online auth",
    'online-mode': true,
})


offline_server.on('listening', () => console.log(`offline server listening`))
online_server.on('listening', () => console.log(`online server listening`))

offline_server.on('login', c => login_handler(c, false))
online_server.on('login', c => login_handler(c, true))

function login_handler(client: Client, online: boolean) {
    const addr = client.socket.remoteAddress
    let endedClient = false
    let endedTargetClient = false
    console.log(`Incoming connection ${addr}`)

    client.on('end', function () {
        endedClient = true
        console.log(`Connection closed by client ${addr}`)
        if (!endedTargetClient) { targetClient.end('End') }
    })

    client.on('error', function (err) {
        endedClient = true
        console.log(`Connection error by client ${addr}`)
        console.log(err.stack)
        if (!endedTargetClient) { targetClient.end('Error') }
    })

    const targetClient = createClient({
        ...connectionOptions,
        username: "blub",
        keepAlive: false,
        skipValidation: true
    })

    targetClient.on('connect', () => {
        //@ts-ignore
        let username = targetClient.username
        console.log(`Connected client ${addr} to ${connectionOptions.host} as ${username}`)
    })

    client.on('packet', function (data, meta) {
        if (targetClient.state === states.PLAY && meta.state === states.PLAY) {
            if (!endedTargetClient) {
                if (meta.name === 'chat') {
                    console.log(data);
                    const message: string = data.message;
                    if (message.indexOf("/,") === 0) {
                        try {
                            let evaled = eval(message.substring(3));
                            console.log(evaled);
                        } catch (e) {
                            console.error(e);
                        }
                        return
                    }
                }
                targetClient.write(meta.name, data)
            }
        }
    })

    targetClient.on('packet', function (data, meta) {
        if (!(meta.state === states.PLAY && client.state === states.PLAY)) { return }
        if (endedClient) { return }

        client.write(meta.name, data)

        if (meta.name === 'chat') {
            if (data.position === 1) {
                const message = ChatMessage.fromNotch(data.message).toString();
                console.log(message);
            }
        }

        if (meta.name === 'set_compression') {
            client.compressionThreshold = data.threshold
        }
    })



    targetClient.on('raw', function (buffer, meta) {
        if (client.state !== states.PLAY || meta.state !== states.PLAY) { return }
    })

    client.on('raw', function (buffer, meta) {
        if (meta.state !== states.PLAY || meta.state !== states.PLAY) { return }
    })

    targetClient.on('end', function () {
        endedTargetClient = true
        console.log(`Connection closed by server ${addr}`)
        if (!endedClient) { client.end('End') }
    })

    targetClient.on('error', function (err) {
        endedTargetClient = true
        console.log(`Connection error by server ${addr}`)
        console.log(err.stack)
        if (!endedClient) { client.end('Error') }
    })
}

function chat_log(m: string, c: Client) {
    const message = MessageBuilder.fromString(`&8[&trash-auth&8] &7${m}`);
    //@ts-ignore
    c.write('chat', { message: JSON.stringify(message), position: 0, sender: '0' });
}

// converts login username to proxied username or rejects
function offline_auth(username: string): string | undefined {
    if (username == "metamuffin") return "user"
    return undefined
}