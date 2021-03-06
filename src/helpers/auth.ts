import { plainToClass } from "class-transformer";

const PORT = "";
// const HOST = "thiccaxe.net/ws";
const HOST = "resonance.razboy.dev";
// const HOST = "148.251.144.4:25560";

import router from "@/router";
import store from "@/store/index";
import _Vue from "vue";
import {
  PeerUpdateAction,
  Player,
  UserUpdateAction,
  WSMessage
} from "@/helpers/interfaces";

let authInfo: _Vue;

let socketQueueId = 0;
const socketQueue: {
  [key in string]: (
    value?: WSMessage | PromiseLike<WSMessage> | undefined
  ) => void;
} = {};

const loadQueue: ((value?: PromiseLike<null>) => void)[] = [];

export function InitializeAuthComponent(
  Vue: typeof _Vue
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
): void {
  authInfo = new _Vue({
    data() {
      return {
        loaded: false,
        authed: false,
        user: {} as Player,
        logType: process.env.NODE_ENV === "development" ? "DEBUG" : "ERROR"
      } as InnerAuthInterface;
    },
    computed: {
      token: {
        get(): string | undefined {
          return store.state.token;
        },
        set(val: string | undefined): void {
          store.commit("setToken", val);
        }
      }
    },
    watch: {
      loaded: val => {
        if (val) loadQueue.forEach(r => r());
      }
    },
    methods: {
      // eslint-disable-next-line
      sendWS(data: Record<string, any>, sendBearer?: boolean, expectReturn: boolean = true): Promise<WSMessage> {
        return new Promise<WSMessage>((resolve, reject) => {
          if (!this.socket) throw Error("Socket is not defined yet.");
          if (this.socket.readyState != this.socket.OPEN) {
            console.error("Socket is in a closing/non-open state.");
            reject();
          }

          if (sendBearer) data["bearer"] = this.token;

          if (expectReturn) {
            socketQueue["i_" + socketQueueId] = resolve;
            this.socket.send(JSON.stringify({ id: socketQueueId, ...data }));

            socketQueueId++;
          } else {
            // console.trace(sendBearer, this.token, data);
            this.socket.send(JSON.stringify(data));
            resolve();
          }
        });
      },

      async authToken(token: string): Promise<boolean> {
        const sendData = {
          action: "authenticate",
          body: { token }
        };

        try {
          const data = await this.sendWS(sendData);
          return data.action == "authenticated";
        } catch {
          this.error =
            "WebSocket connection is closed!\nPlease try again later.";
          return false;
        }
      },

      logout() {
        this.sendWS({ action: "user_logout" }, true, false);
        console.log("User has been logged out.");
        this.token = undefined;
        this.user = undefined;
        this.authed = false;
        router.replace({ name: "login" }).then();
      },

      waitLoad(): Promise<null> {
        return new Promise<null>(resolve => {
          if (this.loaded) resolve();
          else loadQueue.push(resolve);
        });
      },

      // eslint-disable-next-line
      handleUserUpdate(input: Record<string, any>): void {
        const data = plainToClass(UserUpdateAction, input);

        switch (data.type) {
          case "position": {
            if (data.pos && this.user?.pos) {
              // temporarily will add .5 to each positional axis to center to block
              if (data.pos.x) data.pos.x -= 0.5;
              if (data.pos.y) data.pos.y -= 0.5;
              if (data.pos.z) data.pos.z -= 0.5;
              this.user.pos.registerPosition(data.pos);
            }
          }
        }
      },
      // eslint-disable-next-line
      handlePeerUpdate(input: Object[]): void {
        const data = plainToClass(PeerUpdateAction, input);

        console.log(data);

        data.forEach((peer: PeerUpdateAction) => {
          switch (peer.type) {
            case "position": {
              if (peer.pos && this.user?.pos) {
                // temporarily will add .5 to each positional axis to center to block
                if (peer.pos.x) peer.pos.x -= 0.5;
                if (peer.pos.y) peer.pos.y -= 0.5;
                if (peer.pos.z) peer.pos.z -= 0.5;

                const peerInstance = store.state.peers.find(
                  p => p.data?.uuid == peer.data?.uuid
                );
                if (!peerInstance) return;

                peerInstance.pos.registerPosition(peer.pos);
              }
            }
          }
        });
      },
      // eslint-disable-next-line
      handlePeerConnection(input: Record<string, any>): void {
        const peer: Player = plainToClass(Player, input);

        peer.stream = new AudioContext().createMediaStreamDestination().stream;

        store.commit("addPeer", peer);
      },
      // eslint-disable-next-line
      handlePeerDisconnect(input: Record<string, any>): void {
        const peer: Player = plainToClass(Player, input);

        store.commit("removePeer", peer);
      }
    },
    created() {
      /* eslint-disable-next-line */
      (window as any).auth = this;

      const socket = (this.socket = new WebSocket(
        `wss://${HOST}${PORT ? ":" + PORT : ""}`
      ));

      if (this.token) this.authed = true;

      socket.onerror = () => {
        this.loaded = true;
        this.error =
          "WebSocket connection has errored!\nPlease try again later.";
      };

      socket.onopen = async () => {
        // check if authentication token is valid
        /* --- UNCOMMENT ONCE IMPLEMENTED --- */
        if (this.token) {
          const timeoutHandler = setTimeout(() => {
            this.loaded = true;
            this.error = "Websocket took too long to respond!";
          }, 5000);

          const data = await this.sendWS(
            {
              action: "user_info"
            },
            true
          );

          clearTimeout(timeoutHandler);

          if (data.action === "user_info") {
            this.user = plainToClass(Player, data.body.user);
          } else {
            this.token = undefined;
            this.authed = false;
          }
        }

        this.loaded = true;
      };

      socket.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (this.logType == "DEBUG") console.log(data);

          switch (data.action) {
            case "authenticated": {
              this.token = data.body.token;
              this.user = plainToClass(Player, data.body.user);
              this.authed = true;
              break;
            }
            case "auth_failed": {
              // this.token = undefined;
              if (this.token) this.logout();
              break;
            }
            case "keep_alive": {
              socket.send(
                JSON.stringify({
                  action: "keep_alive",
                  body: { token: this.token }
                })
              );
              break;
            }
            case "user_update": {
              this.handleUserUpdate(data.body);
              break;
            }
            case "peer_update": {
              this.handlePeerUpdate(data.body?.peers);
              break;
            }
            case "peer_connect": {
              this.handlePeerConnection(data.body);
              break;
            }
            case "peer_disconnect": {
              this.handlePeerDisconnect(data.body);
              break;
            }
          }

          if (data.id != undefined && socketQueue["i_" + data.id]) {
            socketQueue["i_" + data.id](data);
            delete socketQueue["i_" + data.id];
          }
        } catch (e) {
          console.log(e);
        }
      };

      // setTimeout(() => {
      //   this.loaded = true;
      //   console.log(authInfo);
      // }, 1000);
    }
  });
  Vue.prototype["$auth"] = authInfo;
}

interface InnerAuthInterface {
  token?: string;
  user?: Player;
  loaded: boolean;
  socket?: WebSocket;
  error?: string;
  authed: boolean;
}

export interface AuthInterface extends InnerAuthInterface {
  sendWS(
    /* eslint-disable-next-line */
    data: Record<string, any>,
    sendBearer?: boolean,
    expectReturn?: boolean
  ): Promise<string>;
  authToken(data: string): Promise<boolean>;
  logout(): void;
  waitLoad(): Promise<null>;
}
