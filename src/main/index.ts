import {
	app,
	shell,
	BrowserWindow,
	ipcMain,
	nativeImage,
	Menu,
	Tray,
	dialog,
	session,
} from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import main, { enable } from "@electron/remote/main";
import Store from "electron-store";
import {
	ContextMenuItem,
	ContextMenuStyle,
	PopupWindowProps,
	State,
	allCapabilities,
} from "../shared/types";
import { sendOp } from "../shared/gateway";
import {
	APIUser,
	GatewayOpcodes,
	GatewayReceivePayload,
	GatewayVoiceState,
} from "discord-api-types/v9";
import WebSocket from "ws";
import { writeFileSync } from "fs";
import { PreloadedUserSettings } from "discord-protos";
import { VoiceConnection } from "./util/Voice";
import path from "path";
import { Autoupdater } from "./util/Autoupdater";

function pathToHash(path: string) {
	if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
		return `${process.env["ELECTRON_RENDERER_URL"]}#${path}`;
	} else {
		const indexPath = join(__dirname, "../renderer/index.html");
		return `file://${indexPath}#${path}`;
	}
}

export const mergeObjects = <T extends object = object>(
	target: T,
	...sources: T[]
): T => {
	if (!sources.length) {
		return target;
	}
	const source = sources.shift();
	if (source === undefined) {
		return target;
	}

	if (isMergebleObject(target) && isMergebleObject(source)) {
		Object.keys(source).forEach(function (key: string) {
			if (isMergebleObject(source[key])) {
				if (!target[key]) {
					target[key] = {};
				}
				mergeObjects(target[key], source[key]);
			} else {
				target[key] = source[key];
			}
		});
	}

	return mergeObjects(target, ...sources);
};

const isObject = (item: any): boolean => {
	return item !== null && typeof item === "object";
};

const isMergebleObject = (item): boolean => {
	return isObject(item) && !Array.isArray(item);
};

main.initialize();
Store.initRenderer();

let socket: WebSocket | null;
let state: State;
let win: BrowserWindow | null;
let ctxMenu: BrowserWindow | null;
let interval: NodeJS.Timeout | null;
let trayIcon: Tray | null;
let token: string = "";
let voice: VoiceConnection | null;
let voiceStates: GatewayVoiceState[] = [];
let updateInterval: NodeJS.Timeout | null;

function setVoiceStates(newVoiceStates: GatewayVoiceState[]) {
	voiceStates = newVoiceStates;
	// BrowserWindow.getAllWindows().forEach((window) => {
	// 	window.webContents.send("voice-state-update", voiceStates);
	// });
}

async function showContextMenu(
	id: string,
	menu: ContextMenuItem[],
	x?: number,
	y?: number,
	offsetWidth?: number,
	style?: ContextMenuStyle,
	vertical: "top" | "bottom" = "top",
	horizontal: "left" | "right" = "left",
) {
	if (!ctxMenu) return;
	if (interval) clearInterval(interval);

	ctxMenu.setOpacity(0);
	const steps = 60;
	const timeInMs = 150;
	const time = timeInMs / steps;
	const step = 1 / steps;

	interval = setInterval(() => {
		if (!ctxMenu) return;
		const opacity = ctxMenu.getOpacity();
		if (opacity < 1) {
			ctxMenu.setOpacity(opacity + step);
		}
	}, time);
	setTimeout(() => {
		if (!ctxMenu) return;

		if (interval) clearInterval(interval);
		ctxMenu.setOpacity(1);
	}, timeInMs);
	ctxMenu.webContents.loadURL(
		pathToHash(
			`/context-menu?id=${id}&menu=${encodeURIComponent(
				JSON.stringify(menu),
			)}&x=${x || 0}&y=${y || 0}&offsetWidth=${offsetWidth || 0}&style=${
				style || ContextMenuStyle.Modern
			}&vertical=${vertical}&horizontal=${horizontal}`,
		),
	);

	ctxMenu.reload();

	// ctxMenu.webContents.openDevTools({
	// 	mode: "detach",
	// });
	ctxMenu.setIgnoreMouseEvents(false);
}

const listeners: string[] = [];

const defaultOptions: Electron.BrowserWindowConstructorOptions = {
	width: 329,
	height: 700,
	minWidth: 200,
	minHeight: 600,
	show: false,
	autoHideMenuBar: true,
	icon: nativeImage.createFromPath(`resources/icon-default.ico`),
	backgroundColor: "white",
	title: "Windows Live Messenger",
	webPreferences: {
		preload: join(__dirname, "../preload/index.js"),
		sandbox: false,
		nodeIntegration: true,
		contextIsolation: false,
		webSecurity: false,
	},
};

function findWindowFromPath(path: string): BrowserWindow | undefined {
	for (const window of BrowserWindow.getAllWindows()) {
		const url = new URL(window.webContents.getURL());
		if (url.hash.replace("#", "") === path) {
			return window;
		}
	}
	return undefined;
}

function createPopupWindow(props: PopupWindowProps) {
	const newWindow = new BrowserWindow({
		...defaultOptions,
		...props,
	});
	enable(newWindow.webContents);
	props.customProps.alwaysOnTopValue &&
		newWindow.setAlwaysOnTop(true, props.customProps.alwaysOnTopValue);
	newWindow.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});
	if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
		newWindow.loadURL(
			`${process.env["ELECTRON_RENDERER_URL"]}#${props.customProps.url}`,
		);
	} else {
		const indexPath = join(__dirname, "../renderer/index.html");
		newWindow.loadURL(`file://${indexPath}#${props.customProps.url}`);
	}
	newWindow.on("ready-to-show", () => {
		optimizer.watchWindowShortcuts(newWindow);
		newWindow.show();
	});
	newWindow.removeMenu();
	return newWindow;
}

function createOrFocusWindow(props: PopupWindowProps) {
	const existingWindow = findWindowFromPath(props.customProps.url);
	if (existingWindow) {
		existingWindow.show();
		existingWindow.focus();
	} else {
		createPopupWindow(props);
	}
}

function setState(newState: State) {
	state = newState;
	BrowserWindow.getAllWindows().forEach((window) => {
		window.webContents.send("set-state", newState);
	});
}

function createWindow(): void {
	// Create the browser window.
	const mainWindow = new BrowserWindow(defaultOptions);

	if (process.defaultApp) {
		if (process.argv.length >= 2) {
			app.setAsDefaultProtocolClient("wlmcord", process.execPath, [
				path.resolve(process.argv[1]),
			]);
		}
	} else {
		app.setAsDefaultProtocolClient("wlmcord");
	}

	main.enable(mainWindow.webContents);
	// mainWindow.on("close", (e) => {
	// 	if (ctxMenu) {
	// 		e.preventDefault();
	// 		dialog.showMessageBoxSync(mainWindow, {
	// 			message: "Warning",
	// 			title: "Windows Live Messenger",
	// 			detail: "This window will be minimized to the system tray.",
	// 			type: "info",
	// 			noLink: true,
	// 		});
	// 		mainWindow.hide();
	// 	}
	// });
	mainWindow.on("close", () => {
		try {
			app.quit();
		} catch {}
	});
	mainWindow.on("ready-to-show", () => {
		mainWindow.show();
	});

	mainWindow.webContents.setWindowOpenHandler((details) => {
		shell.openExternal(details.url);
		return { action: "deny" };
	});

	// HMR for renderer base on electron-vite cli.
	// Load the remote URL for development or the local html file for production.
	if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
		mainWindow.loadURL("http://127.0.0.1:5173");
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}
	let firstLoad: boolean = true;
	ipcMain.on("start-gateway", (_e, newToken: string) => {
		token = newToken;
		function configureSocket() {
			socket = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json");
			socket!.onopen = async () => {
				sendOp(
					GatewayOpcodes.Identify,
					{
						token: token,
						capabilities: allCapabilities,
						properties: {
							os: "Linux",
							browser: "Chrome",
							device: "",
							system_locale: "en-GB",
							browser_user_agent:
								"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
							browser_version: "119.0.0.0",
							os_version: "",
							referrer: "",
							referring_domain: "",
							referrer_current: "",
							referring_domain_current: "",
							release_channel: "stable",
							client_build_number: 245648,
							client_event_source: null,
						},
						presence: {
							status: "unknown",
							since: 0,
							activities: [],
							afk: false,
						},
						compress: false,
						client_state: {
							guild_versions: {},
							highest_last_message_id: "0",
							read_state_version: 0,
							user_guild_settings_version: -1,
							user_settings_version: -1,
							private_channels_version: "0",
							api_code_version: 0,
						},
					} as any,
					socket!,
				);
				const res = (
					await (
						await fetch(
							"https://discord.com/api/v9/users/@me/settings-proto/1",
							{
								headers: {
									Authorization: token,
								},
							},
						)
					).json()
				).settings;
				setState({
					...state,
					userSettings: PreloadedUserSettings.fromBase64(res),
				});
			};
			socket!.onmessage = (event) => {
				if (!socket) return;
				const data = JSON.parse(event.data.toString()) as GatewayReceivePayload;
				BrowserWindow.getAllWindows().forEach((window) => {
					listeners.forEach((id) => {
						window.webContents.send(`${id}-data`, JSON.stringify(data));
					});
				});

				switch (data.op) {
					case GatewayOpcodes.Hello: {
						setInterval(() => {
							sendOp(GatewayOpcodes.Heartbeat, null, socket!);
						}, data.d.heartbeat_interval);
						break;
					}
					case GatewayOpcodes.Dispatch: {
						switch (data.t) {
							case "READY": {
								const d = data.d as any;
								setState({
									...state,
									ready: {
										...state?.ready,
										...d,
									},
									userSettings: PreloadedUserSettings.fromBase64(
										d.user_settings_proto,
									),
								});
								voice = new VoiceConnection(token, d.user.id, socket!);
								// redirect the webcontents of win
								if (firstLoad) {
									firstLoad = false;
									win?.loadURL(pathToHash("/home"));
								}
								break;
							}
							case "READY_SUPPLEMENTAL" as any: {
								updateInterval && clearInterval(updateInterval);
								const d = data.d as any;
								setState({
									...state,
									ready: {
										...d,
										...state?.ready,
									},
								});
								setVoiceStates(d.guilds.map((g) => g.voice_states).flat());
								updateInterval = setTimeout(() => {
									Autoupdater.checkForUpdates((t) => {
										if (t === "success") {
											if (updateInterval) clearInterval(updateInterval);
										}
									});
								}, 60000);
								Autoupdater.checkForUpdates((t) => {
									if (t === "success") {
										if (updateInterval) clearInterval(updateInterval);
									}
								});
								break;
							}
							case "VOICE_STATE_UPDATE": {
								const d = data.d;
								const statesMut = [...voiceStates];
								const index = statesMut.findIndex(
									(s) => s.user_id === d.user_id,
								);
								if (index !== -1) {
									statesMut[index] = d;
								} else {
									statesMut.push(d);
								}
								setVoiceStates(statesMut);
							}
						}
					}
					default: {
						// unimplemented
					}
				}
			};
			socket!.onclose = () => {
				// re-open the gateway
				configureSocket();
			};
		}
		configureSocket();
	});
	ipcMain.on("send-op", (_e, data: string) => {
		socket?.send(data);
	});
	ipcMain.on("get-voice-states", (_e) => {
		_e.returnValue = voiceStates;
	});
	ipcMain.on("join-voice", async (_e, guildId: string, channelId: string) => {
		voice?.openVoiceConnection(guildId, channelId);
		trayIcon!.displayBalloon({
			title: "Voice",
			content: "Voice connection has been established.",
			iconType: "info",
		});
		await dialog.showMessageBox(win!, {
			message: "Voice connection",
			title: "Windows Live Messenger",
			detail:
				"Voice connection has been established. Click Disconnect to end the voice session.",
			type: "info",
			noLink: true,
			buttons: ["Disconnect"],
		});
		voice?.closeVoiceConnection();
		trayIcon!.removeBalloon();
		trayIcon!.displayBalloon({
			title: "Voice",
			content: "Voice connection has been closed.",
			iconType: "info",
		});
	});
	ipcMain.on("close-gateway", () => {
		socket = null;
	});

	ipcMain.on("set-state", (_e, newState) => {
		setState(newState);
		BrowserWindow.getAllWindows().forEach((window) => {
			window.webContents.send("set-state", newState);
		});
	});

	ipcMain.on("get-state", (_e) => {
		_e.returnValue = state;
	});

	ipcMain.on("add-gateway-listener", (_e, id: string) => {
		listeners.push(id);
	});

	ipcMain.on("open-dev-tools", (e) => {
		e.sender.openDevTools();
	});

	ipcMain.on(
		"context-menu",
		(
			e,
			id: string,
			menu: ContextMenuItem[],
			x?: number,
			y?: number,
			offsetWidth?: number,
			style?: ContextMenuStyle,
			vertical: "top" | "bottom" = "top",
			horizontal: "left" | "right" = "left",
		) => {
			const win = BrowserWindow.fromWebContents(e.sender);
			function bwActions() {
				ctxMenu?.setIgnoreMouseEvents(true);
				ctxMenu?.setOpacity(0);
				if (e.sender.isDestroyed()) return;
				e.sender.send(`${id}-close`);
				win?.removeListener("move", bwActions);
				win?.removeListener("resize", bwActions);
				win?.removeListener("minimize", bwActions);
				win?.removeListener("maximize", bwActions);
				e.sender.removeListener("blur", onClose);
				ipcMain.removeListener("close-ctx", onClose);
			}
			function onClose(_, selectedId) {
				if (e.sender.isDestroyed()) return;
				e.sender.send(`${id}-close`, selectedId);
				win?.removeListener("move", bwActions);
				win?.removeListener("resize", bwActions);
				win?.removeListener("minimize", bwActions);
				win?.removeListener("maximize", bwActions);
				e.sender.removeListener("blur", onClose);
				ipcMain.removeListener("close-ctx", onClose);
			}
			function onCtxClose(_, href: string) {
				if (href.includes("context-menu")) return;
				ctxMenu?.setIgnoreMouseEvents(true);
				ctxMenu?.setOpacity(0);
				if (e.sender.isDestroyed()) return;
				e.sender.send(`${id}-close`);
				win?.removeListener("move", bwActions);
				win?.removeListener("resize", bwActions);
				win?.removeListener("minimize", bwActions);
				win?.removeListener("maximize", bwActions);
				e.sender.removeListener("blur", onClose);
				ipcMain.removeListener("close-ctx", onClose);
			}
			showContextMenu(id, menu, x, y, offsetWidth, style, vertical, horizontal);
			ipcMain.once(`${id}-close`, onClose);
			e.sender.once("blur", onClose);
			ipcMain.once("close-ctx", onCtxClose);
			win?.once("move", bwActions);
			win?.once("resize", bwActions);
			win?.once("minimize", bwActions);
			win?.once("maximize", bwActions);
		},
	);

	ipcMain.on("remove-gateway-listener", (_e, id: string) => {
		listeners.splice(listeners.indexOf(id), 1);
		BrowserWindow.getAllWindows().forEach((window) => {
			window.webContents.send(`${id}-remove`);
		});
	});

	ipcMain.on("create-window", (_e, props: PopupWindowProps) => {
		props.customProps.checkForDupes
			? createOrFocusWindow(props)
			: createPopupWindow(props);
	});
	ipcMain.on("contact-card", (_e, user: APIUser, x?: number, y?: number) => {
		const win = createPopupWindow({
			customProps: {
				url: `/contact-card?user=${encodeURIComponent(JSON.stringify(user))}${
					x ? `&x=${x}` : ""
				}${y ? `&y=${y}` : ""}`,
				alwaysOnTopValue: "floating",
			},
			width: 350,
			height: 300,
			frame: false,
			resizable: false,
			minWidth: 0,
			minHeight: 0,
			hasShadow: false,
			transparent: true,
			skipTaskbar: true,
			focusable: false,
		});
		win.hide();
	});

	trayIcon = new Tray(nativeImage.createFromPath("resources/icon-default.ico"));
	trayIcon.on("click", () => {
		mainWindow.show();
	});
	trayIcon.setContextMenu(
		Menu.buildFromTemplate([
			{
				label: "Show",
				click() {
					mainWindow.show();
				},
			},
			{
				label: "Exit",
				click() {
					BrowserWindow.getAllWindows().forEach((window) => {
						window.destroy();
					});
					if (!ctxMenu?.isDestroyed()) ctxMenu?.destroy();
					app.quit();
					trayIcon?.destroy();
				},
			},
		]),
	);
	global.trayIcon = trayIcon;
	ctxMenu = new BrowserWindow({
		minWidth: 0,
		minHeight: 0,
		width: 0,
		height: 0,
		frame: false,
		resizable: false,
		transparent: true,
		focusable: false,
		skipTaskbar: true,
		backgroundColor: undefined,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			sandbox: false,
			nodeIntegration: true,
			contextIsolation: false,
		},
	});
	enable(ctxMenu.webContents);
	ctxMenu.setAlwaysOnTop(true, "screen-saver");
	ctxMenu.setSkipTaskbar(true);
	ctxMenu.setOpacity(0);
	ctxMenu.show();
	showContextMenu("", [], 1, -16, 1, ContextMenuStyle.Modern, "top", "left");
	win = mainWindow;
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	app.on("second-instance", (event, commandLine, workingDirectory) => {
		// Someone tried to run a second instance, we should focus our window.
		if (win) {
			if (win.isMinimized()) win.restore();
			win.focus();
		}
		const url = commandLine.pop()?.split(":/")[1]; //ie /guilds/1234567890
		if (!url) return;
		if (url.startsWith("/guild/")) {
			const guildId = url.split("/")[2];
			win?.webContents.send("open-guild", guildId);
		}
		if (url.startsWith("/dm/")) {
			const userId = url.split("/")[2];
			win?.webContents.send("open-dm", userId);
		}
	});
}

app.whenReady().then(() => {
	session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
		details.requestHeaders["User-Agent"] =
			"Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9028 Chrome/108.0.5359.215 Electron/22.3.26 Safari/537.36";
		details.requestHeaders["X-Super-Properties"] =
			"eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiRGlzY29yZCBDbGllbnQiLCJyZWxlYXNlX2NoYW5uZWwiOiJzdGFibGUiLCJjbGllbnRfdmVyc2lvbiI6IjEuMC45MDI4Iiwib3NfdmVyc2lvbiI6IjEwLjAuMTgzNjMiLCJvc19hcmNoIjoieDY0IiwiYXBwX2FyY2giOiJpYTMyIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV09XNjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIGRpc2NvcmQvMS4wLjkwMjggQ2hyb21lLzEwOC4wLjUzNTkuMjE1IEVsZWN0cm9uLzIyLjMuMjYgU2FmYXJpLzUzNy4zNiIsImJyb3dzZXJfdmVyc2lvbiI6IjIyLjMuMjYiLCJjbGllbnRfYnVpbGRfbnVtYmVyIjoyNTgxMDQsIm5hdGl2ZV9idWlsZF9udW1iZXIiOjQxOTM2LCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsLCJkZXNpZ25faWQiOjB9";
		callback({ cancel: false, requestHeaders: details.requestHeaders });
	});
	// Set app user model id for windows
	electronApp.setAppUserModelId("com.electron");

	// Default open or close DevTools by F12 in development
	// and ignore CommandOrControl + R in production.
	// see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils

	createWindow();
	app.on("activate", function () {
		// On macOS it's common to re-create a window in the app when the
		// dock icon is clicked and there are no other windows open.
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
