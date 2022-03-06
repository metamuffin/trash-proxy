import { readFile, watch } from 'fs/promises'
import { states, createServer, createClient, Client, ServerClient, ServerOptions } from 'minecraft-protocol'

export interface Config {
    motd: string,
    favicon?: string,
    favicon_path?: string,
    max_players?: number
    backend_port: number,
    offline_port: number,
    online_port: number,
    version: string
    whitelist: { name: string, token?: string }[]
}
let config = require("./config.json") as Config
load_favicon()

async function load_favicon() {
    try {
        if (config.favicon_path) config.favicon = `data:image/png;base64,${((await readFile(config.favicon_path)).toString("base64"))}`
    } catch (e) {
        console.log("favicon load failed");
    }
}

async function config_watcher() {
    const w = watch(".", { recursive: false })
    for await (const ev of w) {
        if (ev.eventType == "change") {
            try {
                config = JSON.parse((await readFile("./config.json")).toString())
                console.log("config reloaded");
            } catch (e) {
                console.log("config reload failed. invalid");
            }
            await load_favicon()
        }
    }
}
config_watcher()


const ChatMessage = require('prismarine-chat')(config.version)
const { MessageBuilder } = require('prismarine-chat')(config.version)
const mcData = require('minecraft-data')(config.version)

console.log("starting");

export type AuthMethod = "online" | "offline"
export interface ClientData { auth: AuthMethod }
const clients: Map<string, ClientData> = new Map()

const server_options: ServerOptions = {
    host: "0.0.0.0",
    keepAlive: false,
    version: "1.18.1",
    maxPlayers: 1,
    beforePing: response => {
        response.players.online = clients.size;
        response.players.max = config.max_players ?? -Math.floor(Math.random() * 10000);
        response.sample = [...clients.keys()]
        response.favicon = config.favicon
    },
}

const offline_server = createServer({
    ...server_options,
    port: config.offline_port,
    motd: config.motd + " (offline auth)",
    'online-mode': false,
})

const online_server = createServer({
    ...server_options,
    port: config.online_port,
    motd: config.motd + " (online auth)",
    'online-mode': true,
})

offline_server.on('listening', () => console.log(`offline server listening`))
online_server.on('listening', () => console.log(`online server listening`))

offline_server.on('login', c => login_handler(c, "offline"))
online_server.on('login', c => login_handler(c, "online"))

function login_handler(client: Client, auth_method: AuthMethod) {
    const addr = client.socket.remoteAddress
    let ended_client = false
    let ended_target_client = false
    let started_client = false

    console.log(`incomming connection from ${addr} via ${auth_method} auth`)

    client.on('end', () => {
        ended_client = true
        console.log(`connection closed by client ${addr}`)
        if (!ended_target_client && started_client) { target_client.end('End') }
    })

    client.on('error', (err) => {
        ended_client = true
        console.log(`connection error by client ${addr}`)
        console.log(err.stack)
        if (!ended_target_client && started_client) { target_client.end('Error') }
    })

    const username = auth(client, auth_method)
    if (!username) return client.end("auth failed")
    clients.set(username, { auth: auth_method })

    const target_client = createClient({
        host: "127.0.0.1",
        port: config.backend_port,
        version: config.version,
        username,
        keepAlive: false,
        skipValidation: true
    })
    started_client = true

    target_client.on('connect', () => {
        //@ts-ignore
        let username = target_client.username
        chat_log(client, `you have been connected as "${username}"`)
    })

    client.on('packet', (data, meta) => {
        if (target_client.state === states.PLAY && meta.state === states.PLAY) {
            if (!ended_target_client) {
                if (meta.name === 'chat') {
                    let message: string = data.message
                    if (message.startsWith("@@")) {
                        const [command, ...args] = message.substring("@@".length).split(" ")
                        if (!command?.length) return
                        if (command == "info") {
                            const info = clients.get(args[0])
                            if (!info) return chat_log(client, "unknown")
                            chat_log(client, `auth method: ${info.auth}`)
                            return
                        } else return chat_log(client, "unknown command")
                    }
                }
                target_client.write(meta.name, data)
            }
        }
    })

    target_client.on('packet', function (data, meta) {
        if (!(meta.state === states.PLAY && client.state === states.PLAY)) { return }
        if (ended_client) { return }

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



    target_client.on('raw', (buffer, meta) => {
        if (client.state !== states.PLAY || meta.state !== states.PLAY) { return }
    })

    client.on('raw', (buffer, meta) => {
        if (meta.state !== states.PLAY || meta.state !== states.PLAY) { return }
    })

    target_client.on('end', () => {
        ended_target_client = true
        clients.delete(username)
        console.log(`Connection closed by server ${addr}`)
        if (!ended_client) { client.end('End') }
    })

    target_client.on('error', (err) => {
        ended_target_client = true
        clients.delete(username)
        console.log(`Connection error by server ${addr}`)
        console.log(err.stack)
        if (!ended_client) { client.end('Error') }
    })
}

function chat_log(c: Client, m: string) {
    const message = MessageBuilder.fromString(`&8[&atrash-auth&8] &7${m}`);
    c.write('chat', { message: JSON.stringify(message), position: 0, sender: '0' });
}

// converts login username to proxied username or rejects
function auth(client: Client, method: AuthMethod): string | undefined {
    console.log(`${method} auth for ${client.username}`);
    for (const w of config.whitelist) {
        if (client.username == w.token) {
            chat_log(client, "offline auth successful")
            console.log(`auth success (offline)`);
            return w.name
        }
        if (method == "online" && client.username == w.name) {
            chat_log(client, "online auth successful")
            console.log(`auth success (online)`);
            return w.name
        }
    }
}

