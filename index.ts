import { states, createServer, createClient, Client, ServerClient, ServerOptions } from 'minecraft-protocol'

export interface Config {
    motd: string,
    backend_port: number,
    version: string
    whitelist: { name: string, token?: string }[]
}
const config = require("./config.json") as Config

const connectionOptions = {
    host: "127.0.0.1",
    port: config.backend_port,
    version: config.version,
}

const ChatMessage = require('prismarine-chat')(connectionOptions.version)
const { MessageBuilder } = require('prismarine-chat')(connectionOptions.version)
const mcData = require('minecraft-data')(connectionOptions.version)

console.log("starting");

const server_options: ServerOptions = {
    host: "0.0.0.0",
    keepAlive: false,
    version: "1.18.1",
    maxPlayers: 1,
    beforePing: function (response, client) {
        response.players.online = Math.floor(Math.random() * 1000);
        response.players.max = Math.floor(Math.random() * 1000);
    },
}

const offline_server = createServer({
    ...server_options,
    port: 25566,
    motd: config.motd + "(token auth)",
    'online-mode': false,
})

const online_server = createServer({
    ...server_options,
    port: 25567,
    motd: config.motd + "(mojang/microsoft auth)",
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

    let username = client.username
    if (!online) {
        const kl = offline_auth(username)
        if (!kl) return client.end("auth failed")
        chat_log(client, "offline auth successful")
        username = kl
    } else {
        chat_log(client, "online auth successful")
    }

    const targetClient = createClient({
        ...connectionOptions,
        username,
        keepAlive: false,
        skipValidation: true
    })

    targetClient.on('connect', () => {
        //@ts-ignore
        let username = targetClient.username
        console.log(`Connected client ${addr} to ${connectionOptions.host} as ${username}`)
    })

    client.on('packet', (data, meta) => {
        if (targetClient.state === states.PLAY && meta.state === states.PLAY) {
            if (!endedTargetClient) {
                if (meta.name === 'chat') {
                    let message: string = data.message
                    if (message.startsWith("@")) {
                        chat_log(client, message.substring(1))
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

function chat_log(c: Client, m: string) {
    const message = MessageBuilder.fromString(`&8[&atrash-auth&8] &7${m}`);
    c.write('chat', { message: JSON.stringify(message), position: 0, sender: '0' });
}

// converts login username to proxied username or rejects
function offline_auth(username: string): string | undefined {
    if (username == "metamuffin") return "user"
    return undefined
}