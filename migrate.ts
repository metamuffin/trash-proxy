import { readdir, rename } from "fs/promises";
import { join } from "path";
import { argv } from "process";


function java_nameUUIDFromBytes(input: any) {
    let md5Bytes = require("crypto").createHash('md5').update(input).digest();
    md5Bytes[6] &= 0x0f; // clear version       
    md5Bytes[6] |= 0x30; // set to version 3    
    md5Bytes[8] &= 0x3f; // clear variant       
    md5Bytes[8] |= 0x80; // set to IETF variant 
    const hex = md5Bytes.toString('hex')
    const uuid = hex.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, "$1-$2-$3-$4-$5");
    return uuid;
}


async function uuid_to_online_name(uuid: string): Promise<string | undefined> {
    try {
        const res = await require("node-fetch")(`https://api.mojang.com/user/profiles/${encodeURIComponent(uuid)}/names`)
        if (!res.ok) throw new Error("mojang api broken");
        const j = JSON.parse(await res.text())
        return j[j.length - 1].name
    } catch (e) {
        return undefined
    }
}

function name_to_offline_uuid(name: string): string {
    return java_nameUUIDFromBytes(Buffer.from(`OfflinePlayer:${name}`, "utf8"))
}

async function migrate_uuid(uuid: string): Promise<string | undefined> {
    const name = await uuid_to_online_name(uuid)
    if (!name) return
    const new_uuid = name_to_offline_uuid(name)
    console.log(`${uuid} -> ${name.padEnd(15)} -> ${new_uuid}`);
    return new_uuid
}

const path = argv[argv.length - 1]
const path_playerdata = join(path, "world", "playerdata")
async function main() {
    for (const e of await readdir(path_playerdata)) {
        if (!e.endsWith(".dat")) continue
        const uuid = e.substring(0, e.length - ".dat".length)
        const new_uuid = await migrate_uuid(uuid)
        if (!new_uuid) console.log(`migration failed for ${uuid}`);
        const new_e = `${new_uuid}.dat`
        await rename(join(path_playerdata, e), join(path_playerdata, new_e))
    }
    console.log("migration successful");
}
main()
