import net = require("net");
import { Proxy } from "./proxy"

declare global {
    var CLIENT: Client;
}
var CLIENT: Client;

class Client {
    public guest: Guest;
    public ip: string;
    public port: number;

    constructor(ip: string, port: number) {
        this.ip = ip;
        this.port = port;
    }

    run() {
        let socket = net.connect(this.port, this.ip);
        let server = new ServerProxy(socket);
        server.init(30);
        this.entry(server);
        console.log(`server ${this.ip}:${this.port} connected`);
    }

    private entry(proxy: ServerProxy) {
        let guest = new Guest();
        guest.setServer(proxy);
        proxy.setOwner(guest);
        this.guest = guest;
    }
}

class ServerProxy extends Proxy {
    public owner: Guest;

    constructor(socket: net.Socket) {
        super("server", socket);
    }

    setOwner(guest: Guest) {
        this.owner = guest;
        this.on("disconnected", () => {
            this.owner.clearServer();
        });
    }
}

class Guest {
    public server: ServerProxy;
    public id: number;
    public rank: Rank;

    constructor() {
        this.rank = new Rank(this);
    }

    init(data) {
        this.rank.init(data.rank);
    }

    setServer(proxy: ServerProxy) {
        this.server = proxy;
    }

    clearServer() {
        this.server = null;
    }
}

class Rank {
    public self: Guest;
    public score: number;

    constructor(self: Guest) {
        this.self = self;
    }

    init(data: { score: number }) {
        this.score = data.score;
    }

    top(top: number) {
        this.self.server.call("rank.top", { top: top }, (error: Error, reply: RankItem[]) => {
            if (error) {
                console.error(`throw error: ${error.message}`);
            } else {
                reply.forEach(item => {
                    console.log(`id: ${item.id}, score: ${item.score}`);
                });
                console.log();
            }
        });
    }

    update(val: number) {
        this.score += val;
        this.self.server.notify("rank.update", { val: val });
    }

    remove() {
        this.self.server.notify("rank.remove");
    }
}

function logic() {
    setInterval(() => {
        let val = Math.floor(Math.random() * 20);
        CLIENT.guest.rank.update(val);
    }, 3000);
    setInterval(() => {
        CLIENT.guest.rank.top(5);
    }, 10000);
}

function main() {
    let client = new Client("127.0.0.1", 6900);
    client.run();
    CLIENT = client;
    logic();
}

if (module.parent === null) {
    main();
}


interface RankItem {
    id: number;
    score: number;
}
