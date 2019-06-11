import net = require("net");
import { EventEmitter } from "events";

export abstract class Proxy extends EventEmitter {
    public type: "client" | "server";
    private socket: net.Socket;
    private rBuffers: Buffer[];
    private wBuffers: Buffer[];
    private callbacks: Callbacks;
    private callbackid: number;
    private tick: NodeJS.Timer;
    abstract owner: Object;

    constructor(type: "client" | "server", socket: net.Socket) {
        super();
        this.type = type;
        this.socket = socket;
        this.rBuffers = [];
        this.wBuffers = [];
        this.callbacks = {};
        this.callbackid = 0;
    }

    init(tick: number) {
        this.socket.on("data", this.onData.bind(this));
        this.socket.on("error", this.onError.bind(this));
        this.socket.on("close", this.onClose.bind(this));
        this.socket.setTimeout(300000, this.onTimeout.bind(this));
        this.tick = setInterval(() => {
            this.write();
            this.read();
        }, tick);
    }

    call<T>(route: string, argument: Object, callback: Callback<T>, timeout?: number) {
        let id = this.nextId();
        let obj: CallObj = { id: id, route: route, argument: argument };
        if (timeout && timeout > 0) {
            let timer = setTimeout(() => {
                this.callbacks[id].callback(new Error("rpc time out"));
                delete this.callbacks[id];
            }, timeout);
            this.callbacks[id] = { timer: timer, callback: callback };
        } else {
            this.callbacks[id] = { callback: callback };
        }
        let buffer = this.encode(obj);
        this.wBuffers.push(buffer);
    }

    notify(route: string, argument?: Object) {
        let obj: NotifyObj = { route: route, argument: argument };
        let buffer = this.encode(obj);
        this.wBuffers.push(buffer);
    }

    private callback(id: number, error: string, reply: Object) {
        let obj: CallbackObj = { id: id, result: { error: error, reply: reply } };
        let buffer = this.encode(obj);
        this.wBuffers.push(buffer);
    }

    private write() {
        while (this.wBuffers.length) {
            let buffer = this.wBuffers.pop();
            let length = buffer.length;
            let pack = new Buffer(4 + length);
            pack.writeInt32LE(length, 0);
            buffer.copy(pack, 4);
            this.socket.write(pack);
        }
    }

    private read() {
        let length: number = 0;
        for (let i = 0; i < this.rBuffers.length; i++) {
            length += this.rBuffers[i].length;
        }
        if (length < 4) {
            return;
        }
        let buffer = new Buffer(length);
        for (let i = 0, offset = 0; i < this.rBuffers.length; i++) {
            offset += this.rBuffers[i].copy(buffer, offset);
        }
        while (true) {
            let bodyLength = buffer.readInt32LE(0);
            if (buffer.length >= bodyLength + 4) {
                let pack = new Buffer(bodyLength);
                buffer.copy(pack, 0, 4, bodyLength + 4);
                this.dispatch(pack);
                buffer = buffer.slice(bodyLength + 4);
                if (buffer.length < 4) {
                    this.rBuffers = [buffer];
                    break;
                }
            } else {
                this.rBuffers = [buffer];
                break;
            }
        }
    }

    private dispatch(data: Buffer): void {
        let obj: CallObj | CallbackObj = this.decode(data);
        if ((<CallObj>obj).route) {
            let callobj = <CallObj>obj;
            try {
                let route: string[] = callobj.route.split(".");
                let reply;
                if (route.length == 1) {
                    let [method] =route;
                    reply = this.owner[method](callobj.argument);
                } else if (route.length == 2) {
                    let [member, method] =route;
                    reply = this.owner[member][method](callobj.argument);
                } else {
                    throw new Error("route is wrong");
                }
                if (callobj.id) {
                    this.callback(callobj.id, undefined, reply);
                }
            } catch (error) {
                if (callobj.id) {
                    this.callback(callobj.id, (<Error>error).message, undefined);
                }
                console.error(`dispatch call error ${(<Error>error).message}`);
            }
        } else if ((<CallbackObj>obj).result) {
            let callobj = <CallbackObj>obj;
            let callback = this.callbacks[callobj.id];
            if (!callback) {
                return;
            }
            if (callback.timer) {
                clearTimeout(callback.timer);
            }
            let result = callobj.result;
            try {
                if (result.error) {
                    callback.callback(new Error(result.error));
                } else {
                    callback.callback(undefined, result.reply);
                }
            } catch (error) {
                console.error(`dispatch callback error ${(<Error>error).message}`);
            }
            delete this.callbacks[callobj.id];
        } else {
            console.error(`dispatch error ${obj}`);
        }
    }

    private decode(data: Buffer): CallObj | CallbackObj {
        return JSON.parse(data.toString());
    }

    private encode(data: CallObj | CallbackObj | NotifyObj): Buffer {
        return new Buffer(JSON.stringify(data));
    }

    private onData(data: Buffer) {
        this.rBuffers.push(data);
    }

    private onError() {
        for (let id in this.callbacks) {
            if (this.callbacks[id].timer) {
                clearTimeout(this.callbacks[id].timer);
            }
        }
        clearInterval(this.tick);
        this.socket.destroy();
        console.error("socket error");
    }

    private onTimeout() {
        for (let id in this.callbacks) {
            if (this.callbacks[id].timer) {
                clearTimeout(this.callbacks[id].timer);
            }
        }
        clearInterval(this.tick);
        this.socket.destroy();
        console.error("socket timeout");
    }

    private onClose() {
        this.emit("disconnected");
    }

    private nextId() {
        return ++this.callbackid;
    }
}


interface Callback<T> {
    (error: Error, res?: T)
}

interface Callbacks {
    [id: number]: {
        timer?: NodeJS.Timer;
        callback: Callback<Object>;
    }
}

interface CallObj {
    id: number;
    route: string;
    argument: Object;
}

interface CallbackObj {
    id: number;
    result: {
        error: string;
        reply: Object;
    };
}

interface NotifyObj {
    route: string;
    argument: Object;
}
