import net = require("net");
import { Proxy } from "./proxy"

declare global {
    var SERVER: Server;
}
var SERVER: Server;

class Server {
    public server: net.Server;
    public ip: string;
    public port: number;
    public rankManager: RankManager;
    private id: number;
    private guests: { [id: number]: Guest };

    constructor(ip: string, port: number) {
        this.ip = ip;
        this.port = port;
        this.rankManager = new RankManager();
        this.id = 0;
        this.guests = {};
    }

    run(): void {
        this.server = net.createServer(this.onConnected.bind(this));
        this.server.listen(this.port, this.ip, (err: Error) => {
            if (!err) {
                console.log(`Server listening at ${this.ip}:${this.port}...`);
            }
        });
    }

    entry(proxy: ClientProxy) {
        let id = this.nextId();
        let guest = new Guest(id);
        guest.setClient(proxy);
        proxy.setOwner(guest);
        let data = this.getData(id)
        guest.init(data);
        this.guests[id] = guest;
    }

    exit(id: number) {
        delete this.guests[id];
    }

    private onConnected(socket: net.Socket) {
        let client = new ClientProxy(socket);
        client.init(25);
        this.entry(client);
        console.log(`client ${socket.remoteAddress}:${socket.remotePort} connected`);
    }

    private getData(id: number) {
        return { rank: { score: 0 } };
    }

    private nextId(): number {
        return ++this.id;
    }
}

class ClientProxy extends Proxy {
    public owner: Guest;

    constructor(socket: net.Socket) {
        super("client", socket);
    }

    setOwner(guest: Guest) {
        this.owner = guest;
        this.on("disconnected", () => {
            this.owner.clearClient();
        });
    }
}

class Guest {
    public client: ClientProxy;
    public id: number;
    public rank: Rank;

    constructor(id: number) {
        this.id = id;
        this.rank = new Rank(this);
    }

    init(data) {
        this.rank.init(data.rank);
        this.client.notify("init", data);
    }

    destroy() {
        this.rank.destory();
    }

    setClient(proxy: ClientProxy) {
        this.client = proxy;
    }

    clearClient() {
        this.client = null;
        this.destroy();
        SERVER.exit(this.id);
    }
}

class Rank {
    public self: Guest;
    public score: number;

    constructor(self: Guest) {
        this.self = self;
        this.score = 0;
    }

    init(data: { score: number }) {
        this.score = data.score;
        SERVER.rankManager.insert(this.self.id, this.score);
    }

    top(option: { top: number }): RankItem[] {
        return SERVER.rankManager.top(option.top);
    }

    update(option: { val: number }) {
        this.score += option.val;
        SERVER.rankManager.update(this.self.id, option.val);
    }

    destory() {
        this.remove();
    }

    private remove() {
        SERVER.rankManager.remove(this.self.id);
    }
}

class RankManager {
    private ranklist: RankItem[];

    constructor() {
        this.ranklist = [];
    }

    insert(id: number, score: number) {
        this.ranklist.push({ id: id, score: score });
        this.sort();
    }

    update(id: number, val: number) {
        this.ranklist.forEach(item => {
            if (item.id === id) {
                item.score += val;
            }
        });
        this.sort();
    }

    remove(id: number) {
        this.ranklist = this.ranklist.filter(item => {
            return item.id !== id;
        });
        this.sort();
    }

    top(num: number): RankItem[] {
        if (num > this.ranklist.length) {
            num = this.ranklist.length;
        }
        let items: RankItem[] = [];
        for (let i = 0; i < num; i++) {
            items.push(this.ranklist[i]);
        }
        return items;
    }

    private sort() {
        this.ranklist = this.ranklist.sort((lhs: RankItem, rhs: RankItem) => {
            return rhs.score - lhs.score;
        });
    }
}

function main() {
    let server = new Server("127.0.0.1", 6900);
    server.run();
    SERVER = server;
}

if (module.parent === null) {
    main();
}


interface RankItem {
    id: number;
    score: number;
}