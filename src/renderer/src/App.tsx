import { Routes, Route, HashRouter } from "react-router-dom";
import OOBE from "./OOBE"
import Login from "@renderer/pages/Login";
import Home from "@renderer/pages/Home";
import { Context, getSceneFromColor, imageMap } from "@renderer/util";
import { useEffect, useState } from "react";
import { State, Status } from "../../shared/types/index";
import {
	addDispatchListener,
	createWindow,
	getState,
	removeGatewayListener,
	setGatewayState,
} from "./util/ipc";
import {
	GatewayDispatchEvents,
	PresenceUpdateStatus,
} from "discord-api-types/v9";
import Notification from "./pages/Notification";
const { ipcRenderer }: { ipcRenderer: any } = window.require("electron");
import defaultPfp from "@renderer/assets/login/sample-pfp.png";
import ContextMenu from "./pages/ContextMenu";
import Message from "./pages/Message";
import { DiscordUtil, Guild, User } from "./classes/DiscordUtil";
import ContactCard from "./pages/ContactCard";
import Options from "./pages/Options";
import { ErrorBoundary } from "@sentry/react";
import CommandLink from "./components/CommandLink";
import AddFriend from "./pages/AddFriend";
import Customize from "./pages/Customize";
import DisplayPicture from "./pages/DisplayPicture";
const remote = window.require(
	"@electron/remote",
) as typeof import("@electron/remote");
const Store = window.require(
	"electron-store",
) as typeof import("electron-store");

function Error() {
	const win = remote.getCurrentWindow();
	win.setMinimumSize(375, 600);
	win.setMaximumSize(375, 600);
	win.setTitle("An error occured");
	win.setSize(375, 600);
	// play the error sound
	return (
		<div className="error">
			<h1>info</h1>
			An unrecoverable error has occurred.
			<br />
			Please contact me on Discord <b>(emu8086)</b> for assistance. To be
			more helpful, follow the steps below:
			<ol>
				<li>
					Open dev tools ( <kbd data-key="Control">ctrl</kbd> +{" "}
					<kbd data-key="Shift">shift</kbd> + <kbd data-key="i">i</kbd> , or by
					clicking{" "}
					<a
						onClick={() => {
							ipcRenderer.send("open-dev-tools");
						}}
					>
						here
					</a>
					)
				</li>
				<li>take a screenshot of the console</li>
				<li>send me the screenshot</li>
			</ol>
			<h1>actions</h1>
			<CommandLink title="reload" onClick={window.location.reload} />
			<CommandLink
				title="Open dev tools"
				onClick={() => {
					ipcRenderer.send("open-dev-tools");
				}}
			/>
			<CommandLink
				title="Add me on Discord"
				description="Opens the Discord app and displays my profile, so you can contact me for assistance."
				onClick={() => {
					remote.shell.openExternal(
						"https://discord.com/users/1209407339409702953",
					);
				}}
			/>
			<CommandLink
				title="Join the discord server"
				description="Does the same as above, but instead joins the Fullmoon Community Discord server for assistance."
				onClick={() =>
					remote.shell.openExternal("https://discord.gg/Upbs6CXRm4")
				}
			/>
			<CommandLink
				title="Exit"
				onClick={() => {
					remote.app.quit();
				}}
			/>
		</div>
	);
}

function App(): JSX.Element {
	// on ctrl + shift + i
	const store = new Store();
	useEffect(() => {
		store.onDidChange("imageMap", (map) => {
			if (imageMap === map) return;
			window.location.reload();
		});
		return () => {
			store.events.removeAllListeners("change");
		};
	}, []);
	useEffect(() => {
		(async () => {
			[
				(await import("@renderer/assets/ui-elements/checkbox/check.png"))
					.default,
				(await import("@renderer/assets/ui-elements/checkbox/check-hover.png"))
					.default,
				(await import("@renderer/assets/ui-elements/checkbox/check-active.png"))
					.default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-disabled.png"
					)
				).default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-checked.png"
					)
				).default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-checked-hover.png"
					)
				).default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-checked-active.png"
					)
				).default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-checked-disabled.png"
					)
				).default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-indeterminate.png"
					)
				).default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-indeterminate-hover.png"
					)
				).default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-indeterminate-active.png"
					)
				).default,
				(
					await import(
						"@renderer/assets/ui-elements/checkbox/check-indeterminate-disabled.png"
					)
				).default,
			].forEach((url) => {
				const img = new Image();
				img.src = url;
				img.style.opacity = "0";
				img.style.position = "absolute";
				img.style.pointerEvents = "none";
				img.style.zIndex = "-1";
				document.body.appendChild(img);
			});
		})();
	}, []);
	useEffect(() => {
		function keyDown(e: KeyboardEvent) {
			const kbd = document.querySelector(`kbd[data-key="${e.key}"]`);
			if (!kbd) return;
			kbd.classList.add("active");
		}
		function keyUp(e: KeyboardEvent) {
			const kbd = document.querySelector(`kbd[data-key="${e.key}"]`);
			if (!kbd) return;
			kbd.classList.remove("active");
		}
		window.addEventListener("keydown", keyDown);
		window.addEventListener("keyup", keyUp);
		return () => {
			window.removeEventListener("keydown", keyDown);
			window.removeEventListener("keyup", keyUp);
		};
	}, []);
	useEffect(() => {
		function keyDown(e: KeyboardEvent) {
			if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "i")) {
				const kbds = Array.from(document.querySelectorAll("kbd"));
				kbds.forEach((kbd) => kbd.classList.remove("active"));
				ipcRenderer.send("open-dev-tools");
			}
		}
		function mouseDown() {
			ipcRenderer.send("close-ctx", window.location.hash);
		}
		window.addEventListener("keydown", keyDown);
		window.addEventListener("mousedown", mouseDown);
		return () => {
			window.removeEventListener("keydown", keyDown);
			window.removeEventListener("mousedown", mouseDown);
		};
	}, []);
	const initialState = getState();
	const [reactState, setReactState] = useState<State>(initialState as State);
	function setProxyState(newState: State) {
		newState.user = new User(newState.ready?.user) || new User({} as any);
		newState.guilds = newState.ready?.guilds?.map((g) => new Guild(g)) || [];
		newState.users = newState.ready?.users?.map((u) => new User(u)) || [];
		setReactState(newState);
	}
	function setState(newState: State) {
		setGatewayState(newState);
		setProxyState(newState);
	}
	useEffect(() => {
		ipcRenderer.on("set-state", (_, state) => {
			setProxyState(state);
		});
		return () => {
			ipcRenderer.removeAllListeners("set-state");
		};
	}, []);
	useEffect(() => {
		DiscordUtil.updateState(reactState);
		(async () => {
			const thing = await getSceneFromColor(
				reactState?.user?.properties?.accent_color?.toString(16) || "",
			);
			if (thing) {
				const accent = reactState?.ready?.user?.accent_color?.toString(16);
				document.body.style.setProperty(
					"--accent",
					`#${accent === "bae9ff" ? "3eacde" : accent}`,
				);
			} else {
				document.body.style.setProperty("--accent", `#3eacde`);
			}
		})();
	}, [reactState]);
	return (
		<ErrorBoundary fallback={<Error />}>
			<Context.Provider value={{ state: reactState, setState }}>
				<HashRouter>
					<Routes>
						<Route path="/" element={<OOBE />} />
						<Route path="/login" element={<Login />} />
						<Route path="/home" element={<Home />} />
						<Route path="/notification" element={<Notification />} />
						<Route path="/context-menu" element={<ContextMenu />} />
						<Route path="/message" element={<Message />} />
						<Route path="/contact-card" element={<ContactCard />} />
						<Route path="/options" element={<Options />} />
						<Route path="/add-friend" element={<AddFriend />} />
						<Route path="/customize" element={<Customize />} />
						<Route path="/display-picture" element={<DisplayPicture />} />
					</Routes>
				</HashRouter>
			</Context.Provider>
		</ErrorBoundary>
	);
}

export default App;
