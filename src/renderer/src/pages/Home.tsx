import { useContext, useEffect, useRef, useState } from "react";
import styles from "@renderer/css/pages/Home.module.css";
import {
	Context,
	apiReq,
	calcWidth,
	calculateCaretPosition,
	generateRandBetween,
	getSceneFromColor,
	hasParentWithClass,
} from "@renderer/util";
import PfpBorder from "@renderer/components/PfpBorder";
import {
	APIChannel,
	APIDMChannel,
	APIUser,
	ChannelType,
	GatewayDispatchEvents,
	GatewayOpcodes,
	PermissionFlagsBits,
	PresenceUpdateStatus,
} from "discord-api-types/v9";
import defaultPfp from "@renderer/assets/login/sample-pfp.png";
import { sendOp } from "../../../shared/gateway";
import active from "@renderer/assets/home/context-menu/active.png";
import idle from "@renderer/assets/home/context-menu/idle.png";
import invisible from "@renderer/assets/home/context-menu/invisible.png";
import dnd from "@renderer/assets/home/context-menu/dnd.png";
import {
	Banner,
	ContextMenuItemType,
	ContextMenuStyle,
	HomeNotification,
	State,
	Status,
} from "../../../shared/types";
import {
	addDispatchListener,
	closeGateway,
	contactCard,
	contextMenu,
	createWindow,
	getUserStatus,
	removeGatewayListener,
} from "@renderer/util/ipc";
const remote = window.require(
	"@electron/remote",
) as typeof import("@electron/remote");
import { RelationshipTypes } from "../../../shared/types";
import Fuse from "fuse.js";
import {
	Channel,
	DiscordUtil,
	Member,
	computePermissions,
	hasPermission,
} from "@renderer/classes/DiscordUtil";
import { useNavigate } from "react-router-dom";
const Store = remote.require(
	"electron-store",
) as typeof import("electron-store");
import receiveAudio from "@renderer/assets/audio/type.mp3";
import semver from "semver";
const { ipcRenderer } = window.require("electron");
const store = new Store();
import dropdown from "@renderer/assets/ui-elements/dropdown/point_down.png";
import paperOpen from "@renderer/assets/home/ui/paper-open.png";
import paperClose from "@renderer/assets/home/ui/paper-close.png";
import speen from "@renderer/assets/login/speen.png";
import Contact from "@renderer/components/Contact";
import Dropdown from "@renderer/components/Dropdown";
import ImageButton from "@renderer/components/home/ImageButton";
import NewsWidget from "@renderer/components/home/NewsWidget";
import Notification from "@renderer/components/home/HomeNotification";

function blackOrWhite(hex: string) {
	// don't assume hex starts with #
	// determine whether the text color on top of the background should be white or black
	// https://stackoverflow.com/a/3943023
	hex = hex.replace("#", "");
	const r = parseInt(hex.substr(0, 2), 16);
	const g = parseInt(hex.substr(2, 2), 16);
	const b = parseInt(hex.substr(4, 2), 16);
	const yiq = (r * 299 + g * 587 + b * 114) / 1000;
	return yiq >= 128 ? false : true;
}

function Home() {
	let isHovering = false;
	const [isAnimating, setIsAnimating] = useState(false);
	const [input, setInput] = useState<HTMLInputElement | null>(null);
	const { state, setState } = useContext(Context);
	const [notifications, setNotifications] = useState<HomeNotification[]>([]);
	function contactContextMenu(
		user: APIUser,
		e: React.MouseEvent<HTMLDivElement, MouseEvent>,
	) {
		const cursor = remote.screen.getCursorScreenPoint();
		contextMenu(
			[
				{
					type: ContextMenuItemType.Item,
					label: `[b]Send message (${user.username})[/b]`,
					click() {
						doubleClick(user);
					},
				},
				{
					type: ContextMenuItemType.Divider,
				},
				{
					type: ContextMenuItemType.Item,
					label: `View contact card`,
					click() {
						const closest = (e.target as HTMLDivElement).closest(
							`.${styles.contact}`,
						) as HTMLDivElement;
						const window = remote.getCurrentWindow();
						const windowPos = window.getContentBounds();
						const bounds = closest.getBoundingClientRect();
						contactCard(
							user,
							windowPos.x + bounds.left,
							windowPos.y + bounds.top + bounds.height,
						);
					},
				},
			],
			cursor.x,
			cursor.y,
			-50,
		);
	}
	const textColor = blackOrWhite(
		state?.user?.properties?.accent_color?.toString(16) || "3eacde",
	);
	async function doubleClick(data: APIUser | APIChannel) {
		if ("avatar" in data) {
			let userCache = store.get("userCache") || {};
			const user = await DiscordUtil.request<
				never,
				{ user_profile: { accent_color?: number } }
			>(
				`/users/${data?.id}/profile?with_mutual_guilds=false&with_mutual_friends_count=false`,
				"GET",
			);
			userCache = {
				...userCache,
				[data.id]: {
					...user.user_profile,
					date: Date.now(),
				},
			};
			store.set("userCache", userCache);

			let frequentUsers: { [key: string]: number } =
				store.get("frequentUsers") || ({} as any);
			frequentUsers = {
				...frequentUsers,
				[data.id]: (frequentUsers[data.id] || 0) + 1,
			};
			store.set("frequentUsers", frequentUsers);
		} else {
			const guild = state?.guilds?.find((g) =>
				g.properties.channels.map((c) => c.id).includes(data.id),
			);
			if (!guild) return;
			let frequentGuilds: { [key: string]: number } =
				store.get("frequentGuilds") || ({} as any);
			frequentGuilds = {
				...frequentGuilds,
				[guild.properties.id]: (frequentGuilds[guild.properties.id] || 0) + 1,
			};
			store.set("frequentGuilds", frequentGuilds);
		}

		function openMessageWindow(id: string) {
			createWindow({
				customProps: {
					url: `/message?channelId=${id}`,
				},
				width: 550,
				height: 400,
				minWidth: 366,
				minHeight: 248,
				icon: remote.nativeImage.createFromPath("resources/icon-chat.ico"),
			});
		}
		if ("type" in data) {
			if (data.type !== ChannelType.GuildText) return;
			openMessageWindow(data.id);
			return;
		}
		if ("global_name" in data) {
			const dmChannels = state?.ready?.private_channels?.filter(
				(c) => c.type === ChannelType.DM,
			) as (APIDMChannel & {
				recipient_ids: string[];
			})[];
			const channel = dmChannels.find(
				(c) => c.recipient_ids?.length === 1 && c.recipient_ids[0] === data.id,
			);
			if (channel) {
				openMessageWindow(channel.id);
				return;
			}
			const channels = (
				await apiReq("/users/@me/channels", "POST", state?.token || "", {
					recipients: [data.id],
				})
			).body;
			if (!channels.id) return;
			openMessageWindow(channels.id);
			return;
		}
	}
	const [paperSrc, setPaperSrc] = useState("");
	useEffect(() => {
		ipcRenderer.on("open-guild", (e, id: string) => {
			const guild = DiscordUtil.getGuildById(id);
			if (!guild) return;
			const memberReady = DiscordUtil.getMembership(guild);
			if (!memberReady) throw new Error("member not found??");
			const member = new Member(memberReady);
			const channels = guild.properties.channels
				.filter((c) => c.type === ChannelType.GuildText)
				.sort((a, b) => a.position - b.position)
				.map((c) => new Channel(c as any));
			const channel = channels.find((c) =>
				hasPermission(
					computePermissions(member, c),
					PermissionFlagsBits.ViewChannel,
				),
			);
			if (!channel) return;
			doubleClick(channel.properties);
		});
		ipcRenderer.on("open-dm", async (e, userId: string) => {
			doubleClick(state?.ready?.users?.find((u) => u.id === userId)!);
		});
		return () => {
			ipcRenderer.removeAllListeners("open-guild");
		};
	}, []);
	useEffect(() => {
		const ids = [
			addDispatchListener(GatewayDispatchEvents.PresenceUpdate, (d) => {
				const mutState = { ...state };
				if (d.guild_id) {
					if (!mutState.ready?.merged_presences?.guilds) return;
					const guildIndex = mutState.ready?.guilds.findIndex(
						(g) => g.id === d.guild_id,
					);
					if (guildIndex === -1) return;
					const guild = mutState.ready?.merged_presences?.guilds[guildIndex];
					const memberIndex = guild.findIndex((m) => m.user_id === d.user.id);
					if (memberIndex !== -1)
						mutState.ready?.merged_presences?.guilds[guildIndex].splice(
							memberIndex,
							1,
						);
					const { user, ...rest } = d;
					mutState.ready?.merged_presences?.guilds[guildIndex].push({
						...(rest as any),
						user_id: d.user.id,
					});
				}
				if (!mutState?.ready?.merged_presences?.friends) return;
				let friend = mutState.ready?.merged_presences?.friends.find(
					(f) => (f.user?.id || f.user_id) === d.user.id,
				);
				if (!friend) {
					mutState.ready?.merged_presences?.friends.push(d as any);
					setState(mutState);
					return;
				}
				if (mutState.ready?.merged_presences?.friends)
					mutState.ready.merged_presences.friends =
						mutState.ready?.merged_presences?.friends.filter(
							(f) => (f.user_id || f.user?.id) !== d.user.id,
						);
				const finalFriend = {
					status: d.status || friend.status,
					activities: d.activities || friend.activities,
					client_status: d.client_status || friend.client_status,
					user_id: d.user.id,
				};
				mutState.ready?.merged_presences?.friends.push(finalFriend as any);
				if (mutState === state) return;
				setState(mutState);
			}),
			addDispatchListener(GatewayDispatchEvents.UserUpdate, (d) => {
				const mutState = { ...state };
				const index = mutState.ready?.users?.findIndex((u) => u.id === d.id);
				if (index === -1) return;
				mutState.ready.users[index] = d;
				setState(mutState);
			}),
		];
		return () => {
			ids.forEach((id) => removeGatewayListener(id));
		};
	}, [state]);
	useEffect(() => {
		async function getNotifications() {
			const res = await fetch(
				`https://gist.github.com/not-nullptr/26108f2ac8fcb8a24965a148fcf17363/raw?bust=${Date.now()}`,
			);
			const json = await res.json();
			const seen = Object.values(
				new Store().get("seenNotifications") || {},
			) as number[];
			// check if theres a new notification we havent seen yet
			const newNotification = json.find(
				(n: HomeNotification) =>
					!seen.includes(n.date) &&
					(n.targets
						? semver.satisfies(remote.app.getVersion(), n.targets)
						: true) &&
					!notifications.find((m) => m.date === n.date),
			);
			const canReceive = state.ready.sessions.every(
				(val) => val.status != "dnd",
			);
			if (newNotification && canReceive) {
				const trayIcon: Electron.CrossProcessExports.Tray =
					remote.getGlobal("trayIcon");
				trayIcon.displayBalloon({
					title: "Windows Live Messenger",
					content:
						"A new notification has arrived. Open the home page to read it.",
					iconType: "info",
				});
			}
			setNotifications(json);
		}
		// grab notifications every 1 minute
		const interval = setInterval(getNotifications, 1000 * 60);
		getNotifications();
		const fn = async () => {
			const jumpList: Electron.JumpListCategory[] = [];
			let listOfDmedUsers: { [key: string]: number } =
				store.get("frequentUsers") || ({} as any);
			let listOfGuilds: { [key: string]: number } =
				store.get("frequentGuilds") || ({} as any);
			if (Object.keys(listOfDmedUsers).length) {
				listOfDmedUsers = Object.fromEntries(
					Object.entries(listOfDmedUsers)
						.sort(([, a], [, b]) => b - a)
						.slice(0, 5),
				);
				jumpList.push({
					name: "Frequent Users",
					items: (
						await Promise.all(
							Object.entries(listOfDmedUsers).map(
								async ([id, count]): Promise<Electron.JumpListItem> => {
									const user = DiscordUtil.getUserById(id);
									// const avatar = await DiscordUtil.getAvatarPath(user);
									return {
										type: "task",
										args: "",
										description: `Opens a DM with ${DiscordUtil.getUserById(id)
											?.username}`,

										program: `wlmcord://dm/${id}`,
										// iconPath: avatar || "",
										iconIndex: 0,
										title: user?.global_name || user?.username || "Unknown",
									};
								},
							),
						)
					).filter((j) => j.title !== "Unknown"),
				});
			}
			if (Object.keys(listOfGuilds).length) {
				listOfGuilds = Object.fromEntries(
					Object.entries(listOfGuilds)
						.sort(([, a], [, b]) => b - a)
						.slice(0, 5),
				);
				jumpList.push({
					name: "Frequent Guilds",
					items: (
						await Promise.all(
							Object.entries(listOfGuilds).map(
								async ([id, count]): Promise<Electron.JumpListItem> => {
									const guild = DiscordUtil.getGuildById(id);
									// const icon = await DiscordUtil.getAvatarPath(
									// 	guild?.properties as any,
									// );
									return {
										type: "task",
										description: `Opens ${guild?.properties?.properties?.name}`,
										program: `wlmcord://guild/${id}`,
										// iconPath: icon || "",
										iconIndex: 0,
										title: guild?.properties?.properties?.name || "Unknown",
									};
								},
							),
						)
					).filter((j) => j.title !== "Unknown"),
				});
			}
			remote.app.setJumpList(jumpList);
		};
		fn();
		const frequent = setInterval(fn, 1000);
		return () => {
			clearInterval(interval);
			clearInterval(frequent);
		};
	}, []);
	function setStatus(status: PresenceUpdateStatus) {
		let mutState = { ...state };
		mutState.ready.sessions[0].status = status;
		sendOp(GatewayOpcodes.PresenceUpdate, {
			status:
				status === PresenceUpdateStatus.Offline
					? PresenceUpdateStatus.Invisible
					: status,
			since: 0,
			activities: [
				localStorage.getItem("statusMessage")
					? ({
							name: "Custom Status",
							type: 4,
							state: localStorage.getItem("statusMessage") || "",
							emoji: null,
					  } as any)
					: null,
			],
			afk: false,
		});
		setState(mutState);
	}
	let lastAd = -1;
	const [ads, setAds] = useState<Banner[]>([]);
	const [ad, setAd] = useState<Banner>();
	useEffect(() => {
		function mouseDown(e: MouseEvent) {
			if (e.button !== 0) return;
			if (hasParentWithClass(e.target as HTMLElement, styles.contact)) return;
			document.querySelectorAll(`.${styles.contact}`).forEach((c) => {
				c.classList.remove(styles.selected);
			});
		}
		document.addEventListener("mousedown", mouseDown);
		return () => {
			document.removeEventListener("mousedown", mouseDown);
		};
	});
	useEffect(() => {
		async function fetchBanners() {
			const json: Banner[] = await (
				await fetch(
					`https://gist.github.com/not-nullptr/d6d44dde7ce95aeef619e1c1eb944738/raw?bust=${Date.now()}`,
				)
			).json();
			const date = Date.now();
			setAds(json.filter((b) => b.expiresOn === 0 || b.expiresOn > date));
		}
		fetchBanners();
		// fetch every 10 minutes, (1000 * 60 * 10)ms
		setInterval(fetchBanners, 1000 * 60 * 10);
	}, []);
	function intervalFn() {
		setAd(ads[generateRandBetween(0, ads.length - 1, lastAd)]);
	}
	useEffect(() => {
		intervalFn();
		const interval = setInterval(intervalFn, 20000);
		return () => {
			clearInterval(interval);
		};
	}, [ads]);
	// useEffect(() => {
	// 	if (!editingStatus) return;
	// 	inputRef.current?.focus();
	// }, [editingStatus]);
	useEffect(() => {
		if (!input) return;
		input.placeholder = input.value ? "" : "Share a quick message";
		input.style.width = `${calcWidth(input.value || input.placeholder)}px`;
	}, [input]);
	const [backgroundImage, setBackgroundImage] = useState<string | null>();
	useEffect(() => {
		(async () => {
			const img = await getSceneFromColor(
				state?.user?.properties?.accent_color?.toString(16) || "",
			);
			setBackgroundImage(img);
		})();
	}, [state?.ready?.user]);
	const [search, setSearch] = useState("");
	const [contextMenuOpacity, setContextMenuOpacity] = useState("0");
	useEffect(() => {
		function mouseDown(e: MouseEvent) {
			if (e.button !== 0) return;
			const el = e.target as HTMLDivElement;
			if (el.closest(`.${styles.contextMenu}`)) return;
			if (el.closest(`.${styles.contextMenuItem}`)) return;
			setContextMenuOpacity("0");
		}
		document.addEventListener("mousedown", mouseDown);
		return () => {
			document.removeEventListener("mousedown", mouseDown);
		};
	}, []);
	useEffect(() => {
		function getWindow(path: string) {
			for (const window of remote.BrowserWindow.getAllWindows()) {
				const rawUrl = window.webContents.getURL();
				if (!rawUrl) continue;
				const url = new URL(rawUrl);
				if (url.hash.replace("#", "") === path) return window;
			}
			return null;
		}
		const id = addDispatchListener(GatewayDispatchEvents.MessageCreate, (d) => {
			const privateChannel = state?.ready?.private_channels?.find(
				(c) => c.id === d.channel_id,
			);
			const shouldOpen =
				(!!d.mentions.find((m) => m.id === state?.user?.properties?.id) ||
					(privateChannel && privateChannel.type !== ChannelType.GroupDM)) &&
				d.author.id !== state?.user?.properties?.id;
			if (shouldOpen) {
				const oldWin = getWindow(`/message?channelId=${d.channel_id}`);
				const audio = new Audio(receiveAudio);
				if (oldWin) {
					oldWin.flashFrame(true);
					oldWin.setAlwaysOnTop(true);
					oldWin.setAlwaysOnTop(false);
					oldWin.focus();
					return;
				}
				audio.play();
				createWindow({
					customProps: {
						url: `/message?channelId=${d.channel_id}`,
					},
					width: 550,
					height: 400,
					minWidth: 366,
					minHeight: 248,
					icon: remote.nativeImage.createFromPath("resources/icon-chat.ico"),
				});
				const window = getWindow(`/message?channelId=${d.channel_id}`);
				if (!window) return;
				window.flashFrame(true);
				window.focus();
			}
			// // open a window
			// createWindow({
			// 	customProps: {
			// 		url: `/message?channelId=${d.channel_id}`,
			// 	},
			// 	width: 550,
			// 	height: 400,
			// 	minWidth: 366,
			// 	minHeight: 248,
			// 	icon: remote.nativeImage.createFromPath("resources/icon-chat.ico"),
			// });
		});
		return () => {
			removeGatewayListener(id);
		};
	}, []);
	const userStatus = state.ready?.sessions[0];
	const status = state.ready?.sessions[0]?.activities?.find(
		(a) => a.type === 4,
	);
	const friends = state?.ready?.relationships
		?.filter((r) => r.type === RelationshipTypes.FRIEND)
		?.filter(Boolean)
		?.map((u) => ({
			user: state?.ready?.users?.find(
				(v) => v.id === u.id,
			) as unknown as APIUser,
			status: state?.ready?.merged_presences?.friends?.find(
				(v) => v.user_id === u.id,
			) || {
				activities: [],
				client_status: {},
				status: "offline" as Status,
				user_id: u.id,
				user: {
					id: u.id,
				},
			},
		}))
		.filter(Boolean);
	const onlineUnsearched = friends
		?.filter((f) => f.status.status !== Status.Offline)
		.sort((a, b) =>
			(a.user.global_name || a.user.username).localeCompare(
				b.user.global_name || b.user.username,
			),
		)
		.filter(Boolean);
	const online = search
		? new Fuse(onlineUnsearched, {
				keys: [
					{
						name: "username",
						weight: 1,
						getFn: (obj) => obj.user.global_name || obj.user.username,
					},
				],
		  })
				.search(search)
				.map((s) => s.item)
		: onlineUnsearched;
	const offlineUnsearched = friends
		?.filter((f) => f.status.status === Status.Offline)
		.sort((a, b) =>
			(a.user.global_name || a.user.username).localeCompare(
				b.user.global_name || b.user.username,
			),
		)
		.filter(Boolean);
	const offline = search
		? new Fuse(offlineUnsearched, {
				keys: [
					{
						name: "username",
						weight: 1,
						getFn: (obj) => obj.user.global_name || obj.user.username,
					},
				],
		  })
				.search(search)
				.map((s) => s.item)
		: offlineUnsearched;
	const dmsUnsearched = state?.ready?.private_channels
		?.filter((c) => c.type === ChannelType.DM)
		?.filter((c) => c.last_message_id !== null)
		?.filter(
			(c) =>
				!state?.ready?.relationships
					?.map((r) => r.user_id)
					.includes(c.recipient_ids[0]),
		)
		.filter((c) => c.recipient_ids.length === 1)
		.sort(
			(a, b) =>
				(DiscordUtil.getDateById(b.last_message_id) || 0) -
				(DiscordUtil.getDateById(a.last_message_id) || 0),
		)
		.map((c) => ({
			user: state?.ready?.users?.find((v) => v.id === c.recipient_ids[0])!,
			status: state?.ready?.merged_presences?.guilds
				?.flat()
				?.find((p) => p.user_id === c.recipient_ids[0]) || {
				activities: [],
				client_status: {},
				status: "offline" as Status,
				user_id: c.recipient_ids[0],
				user: {
					id: c.recipient_ids[0],
				},
			},
		}));
	const dms = search
		? new Fuse(dmsUnsearched, {
				keys: [
					{
						name: "username",
						weight: 1,
						getFn: (obj) => obj.user.global_name || obj.user.username,
					},
				],
		  })
				.search(search)
				.map((s) => s.item)
		: dmsUnsearched;
	// const channels = state?.guilds
	// 	?.map((g) =>
	// 		g.channels.map((c) => ({
	// 			guild: g,
	// 			channel: c,
	// 		})),
	// 	)
	// 	.flat();
	// const guilds = state?.guilds.sort((a, b) =>
	// 	a.properties?.name.localeCompare(b.properties?.name),
	// );
	// const noFolders =
	// 	state?.userSettings?.guildFolders?.folders
	// 		?.filter((f) => f.guildIds.length === 1)
	// 		?.map((f) => ({
	// 			properties: f,
	// 			guilds: f.guildIds.map(
	// 				(g) => state.ready?.guilds.find((h) => h.id === g.toString()) as Guild,
	// 			),
	// 		}))
	// 		?.sort((a, b) =>
	// 			(
	// 				a.properties?.name?.value || a.guilds[0].properties?.name
	// 			).localeCompare(
	// 				b.properties?.name?.value || b.guilds[0].properties?.name,
	// 			),
	// 		) || [];
	// const folders =
	// 	state?.userSettings?.guildFolders?.folders
	// 		?.filter((f) => f.guildIds.length > 1)
	// 		?.map((f) => ({
	// 			properties: f,
	// 			guilds: f.guildIds.map(
	// 				(g) => state.ready?.guilds.find((h) => h.id === g.toString()) as Guild,
	// 			),
	// 		})) || [];
	// const guilds = search
	// 	? new Fuse([...folders, ...noFolders], {
	// 			keys: [
	// 				{
	// 					name: "name",
	// 					weight: 1,
	// 					getFn: (obj) =>
	// 						obj.properties?.name?.value +
	// 						" " +
	// 						obj.guilds.map((g) => g.properties?.name).join(" "),
	// 				},
	// 			],
	// 	  })
	// 			.search(search)
	// 			.map((s) => s.item)
	// 	: [...folders, ...noFolders];
	let guilds =
		state.userSettings?.guildFolders?.folders
			.map((folder) => {
				const guilds = folder.guildIds.map(
					(g) => state.guilds?.find((h) => h.properties.id === g.toString())!,
				);
				return {
					folder: folder,
					guilds: guilds?.filter((g) => !!g),
					isFolder: guilds?.length !== 1,
				};
			})
			.flat()
			.filter((g) => !!g.guilds) || [];
	guilds = [
		{
			folder: undefined as any,
			isFolder: false,
			guilds: state?.guilds
				.filter(
					(g) =>
						!guilds
							.map((g) => g.guilds)
							.flat()
							.map((g) => g.properties.id)
							.includes(g.properties.id),
					// sort by joined_at, which we need to parse into a number
				)
				.sort((a, b) => {
					const aDate = new Date(a.properties.joined_at || 0).getTime();
					const bDate = new Date(b.properties.joined_at || 0).getTime();
					return aDate - bDate;
				}),
		},
		...guilds,
	];
	const groupChats =
		state?.ready?.private_channels?.filter(
			(c) => c.type === ChannelType.GroupDM,
		) || [];
	const navigate = useNavigate();
	return !state.ready?.user?.id ? (
		<>
			<img src={speen} />
		</>
	) : (
		<div className={styles.window}>
			<div
				className={styles.background}
				onMouseEnter={() => {
					setPaperSrc(paperOpen);
				}}
				onMouseLeave={() => {
					setPaperSrc(paperClose);
				}}
			>
				<div
					className={styles.bgImage}
					// style={{
					// 	backgroundImage: state?.user?.properties?.banner
					// 		? `url(https://cdn.discordapp.com/banners/${state.ready.user.id}/${state.ready.user.banner}.png?size=480)`
					// 		: undefined,
					// 	opacity: state?.user?.properties?.banner ? "0.75" : undefined,
					// 	WebkitMask: state?.user?.properties?.banner
					// 		? "linear-gradient(to bottom, #fff, #000)"
					// 		: undefined,
					// 	mask: state?.user?.properties?.banner
					// 		? "linear-gradient(to bottom, #fff, #000)"
					// 		: undefined,
					// }}
					style={{
						backgroundImage: backgroundImage
							? `url("${backgroundImage}")`
							: undefined,
					}}
				/>
				<img
					onClick={() => {
						createWindow({
							customProps: {
								url: "/customize",
							},
							width: 535,
							height: 586,
							minWidth: 535,
							minHeight: 586,
							maxWidth: 535,
							maxHeight: 586,
							minimizable: false,
							maximizable: false,
						});
					}}
					src={paperSrc}
					className={styles.paper}
				/>
				<div className={styles.topInfo}>
					<div
						style={{
							cursor: "pointer",
						}}
						onMouseDown={() => {
							createWindow({
								customProps: {
									url: "/display-picture",
								},
								minWidth: 484,
								minHeight: 578,
								maxWidth: 484,
								maxHeight: 578,
								width: 484,
								height: 578,
							});
						}}
					>
						<PfpBorder
							stateInitial={userStatus?.status as PresenceUpdateStatus}
							pfp={
								state?.user?.properties?.avatar
									? `https://cdn.discordapp.com/avatars/${state?.ready?.user
											?.id}/${state?.user?.properties?.avatar}.${
											state?.ready?.user?.avatar?.startsWith("a_")
												? "gif"
												: "webp"
									  }?size=256`
									: defaultPfp
							}
						/>
					</div>
					<div className={styles.userInfo}>
						<div
							onClick={() => {
								setContextMenuOpacity("1");
								const window = remote.getCurrentWindow();
								const windowPos = window.getContentBounds();
								const usernameContainer = document.querySelector(
									`.${styles.usernameContainer}`,
								) as HTMLDivElement;
								const bounds = usernameContainer.getBoundingClientRect();
								setContextMenuOpacity("0");
								contextMenu(
									[
										{
											click() {
												setStatus(PresenceUpdateStatus.Online);
											},
											label: "Available",
											icon: active,
											type: ContextMenuItemType.Item,
										},
										{
											click() {
												setStatus(PresenceUpdateStatus.DoNotDisturb);
											},
											label: "Busy",
											icon: dnd,
											type: ContextMenuItemType.Item,
										},
										{
											click() {
												setStatus(PresenceUpdateStatus.Idle);
											},
											label: "Away",
											icon: idle,
											type: ContextMenuItemType.Item,
										},
										{
											click() {
												setStatus(PresenceUpdateStatus.Invisible);
											},
											label: "Appear offline",
											icon: invisible,
											type: ContextMenuItemType.Item,
										},
										{
											type: ContextMenuItemType.Divider,
										},
										{
											label: `Sign out from here (${remote
												.require("os")
												.hostname()})`,
											type: ContextMenuItemType.Item,
											click() {
												closeGateway();
												store.set("token", null);
												store.set("autoLogin", null);
												setState({} as State);
												navigate("/");
											},
										},
										{
											type: ContextMenuItemType.Divider,
										},
										{
											type: ContextMenuItemType.Item,
											label: "Change display picture...",
										},
										{
											type: ContextMenuItemType.Item,
											label: "Change scene...",
										},
										{
											type: ContextMenuItemType.Item,
											label: "Change display name...",
										},
										{
											type: ContextMenuItemType.Divider,
										},
										{
											type: ContextMenuItemType.Item,
											label: "Options...",
											click() {
												createWindow({
													customProps: {
														url: "/options",
													},
													width: 550,
													height: 400,
													minWidth: 366,
													minHeight: 248,
													icon: remote.nativeImage.createFromPath(
														"resources/icon.ico",
													),
												});
											},
										},
									],
									windowPos.x + bounds.left,
									windowPos.y + bounds.top + bounds.height,
									50,
									ContextMenuStyle.Classic,
								).then(() => setContextMenuOpacity("0"));
							}}
							className={styles.usernameContainer}
							data-toggled={`${contextMenuOpacity === "1"}`}
						>
							<span
								className={styles.username}
								style={
									{
										"--text-color": textColor ? "#ddd" : "black",
										"--shadow-color": textColor ? "black" : "white",
									} as any
								}
							>
								{state.ready.user.global_name || state.ready.user.username}
								<span className={styles.usernameStatus}>
									({getUserStatus(userStatus?.status as any)})
								</span>
							</span>
							<img src={dropdown} />
						</div>
						<div
							className={styles.message}
							style={{ display: "flex", alignItems: "center" }}
						>
							<input
								style={
									{
										"--text-color": textColor ? "white" : "black",
										"--shadow-color": textColor ? "black" : "white",
									} as any
								}
								ref={setInput}
								defaultValue={status?.state}
								contentEditable={true}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.currentTarget.blur();
									}
								}}
								onChange={(e) => {
									e.currentTarget.style.width = `${calcWidth(
										e.currentTarget.value,
									)}px`;
								}}
								onFocus={(e) => {
									e.currentTarget.placeholder = "";
									e.currentTarget.style.width = `${calcWidth(
										e.currentTarget.value || e.currentTarget.placeholder,
									)}px`;
								}}
								// defaultValue={liveState.statusMessage || ""}
								onBlur={(e) => {
									const statusMessage = e.currentTarget.value;
									localStorage.setItem("statusMessage", statusMessage);
									e.currentTarget.placeholder = "Share a quick message";
									e.currentTarget.style.width = `${calcWidth(
										e.currentTarget.value || e.currentTarget.placeholder,
									)}px`;
									sendOp(GatewayOpcodes.PresenceUpdate, {
										status:
											(state?.ready?.sessions[0]?.status as any) ||
											PresenceUpdateStatus.Offline,
										since: 0,
										activities: [
											{
												name: "Custom Status",
												type: 4,
												state: statusMessage,
												emoji: null,
											} as any,
										],
										afk: false,
									});
								}}
								onMouseDown={(e) => {
									if (document.activeElement === e.currentTarget) return;
									e.preventDefault();
								}}
								onMouseUp={(e) => {
									const target = e.currentTarget;
									if (document.activeElement === target) return;

									e.preventDefault();
									target.focus();

									const mouseX = e.clientX;
									const text = target.value;
									const caretPos = calculateCaretPosition(target, mouseX, text);

									if (target.setSelectionRange) {
										target.setSelectionRange(caretPos, caretPos);
									}
								}}
							/>
							<img style={{ marginRight: 4 }} src={dropdown} />
						</div>
					</div>
					<ImageButton className={styles.mail} type="mail" />
				</div>
			</div>
			<div className={styles.divider} />
			<div className={styles.content}>
				<div className={styles.padded}>
					<div className={styles.searchContainer}>
						<input
							required
							onChange={(e) => setSearch(e.target.value)}
							className={styles.search}
							placeholder="Search contacts or the Web..."
						/>
						<div className={styles.searchButtons}>
							<ImageButton
								onClick={() => {
									createWindow({
										customProps: {
											url: "/add-friend",
										},
										width: 515,
										height: 478,
										minWidth: 515,
										minHeight: 478,
										maxWidth: 515,
										maxHeight: 478,
									});
								}}
								type="add-friend"
							/>
							<ImageButton type="windows" />
							<ImageButton
								type="help"
								onClick={() => window.open("https://wlmcord.fullmooncommunity.github.io", "_blank")}
							/>
						</div>
					</div>
				</div>
				<Notification notifications={notifications} />
				<div className={styles.contactsContainer}>
					<div className={styles.contacts}>
						<Dropdown
							header="Online"
							info={`(${online.length}/${friends.length})`}
						>
							{onlineUnsearched?.map((c) => (
								<Contact
									style={{
										display: search
											? online?.map((d) => d.user?.id).includes(c.user?.id)
												? ""
												: "none"
											: "",
									}}
									onDoubleClick={() => doubleClick(c.user)}
									onContextMenu={(e) => contactContextMenu(c.user, e)}
									key={c.user?.id}
									{...c}
								/>
							))}
						</Dropdown>
						<Dropdown header="Unfriended DMs" info={`(${dms?.length})`}>
							{dmsUnsearched?.filter(Boolean).map((c) => (
								<Contact
									style={{
										display: search
											? dms?.map((d) => d.user?.id).includes(c.user?.id)
												? ""
												: "none"
											: "",
									}}
									onDoubleClick={() => doubleClick(c.user)}
									onContextMenu={(e) => contactContextMenu(c.user, e)}
									key={c.user?.id}
									status={c.status}
									user={c.user}
								/>
							))}
						</Dropdown>
						<Dropdown header="Group Chats" info={`(${groupChats?.length})`}>
							{groupChats.map((c) => (
								<Contact
									onDoubleClick={() => {
										createWindow({
											customProps: {
												url: `/message?channelId=${c.id}`,
											},
											width: 550,
											height: 400,
											minWidth: 366,
											minHeight: 248,
											icon: remote.nativeImage.createFromPath(
												"resources/icon-chat.ico",
											),
										});
									}}
									key={c.id}
									user={
										{
											id: c.id,
											avatar: c?.icon,
											global_name:
												c?.name ||
												c?.recipient_ids
													.map(
														(id) =>
															state.ready.users.find((u) => u.id === id)
																?.global_name ||
															state.ready.users.find((u) => u.id === id)
																?.username,
													)
													.join(", "),
										} as any
									}
									status={PresenceUpdateStatus.Online as any}
									groupchat
								/>
							))}
						</Dropdown>
						<Dropdown
							header="Servers"
							info={`(${guilds?.map((g) => g.guilds).length})`}
						>
							{guilds?.map((f) =>
								f.isFolder ? (
									<Dropdown
										header={f.folder.name?.value || "Unnamed folder"}
										info={`(${f.guilds?.length})`}
										color={
											"#" +
												f.folder.color?.value.toString(16).padStart(6, "0") ||
											undefined
										}
									>
										{f.guilds
											?.filter((g) => !!g)
											.map((c) => (
												<Contact
													// style={{
													// 	display: search
													// 		? guilds?.map((d) => d.id).includes(c.id)
													// 			? ""
													// 			: "none"
													// 		: "",
													// }}
													format=".webp?size=256"
													onDoubleClick={() => {
														const memberReady = DiscordUtil.getMembership(c);
														if (!memberReady)
															throw new Error("member not found??");
														const member = new Member(memberReady);
														const channels = c.properties.channels
															.filter((c) => c.type === ChannelType.GuildText)
															.sort((a, b) => a.position - b.position)
															.map((c) => new Channel(c as any));
														const channel = channels.find((c) =>
															hasPermission(
																computePermissions(member, c),
																PermissionFlagsBits.ViewChannel,
															),
														);
														if (!channel) return;
														doubleClick(channel.properties);
													}}
													key={c.properties.id}
													user={
														{
															id: c.properties.id,
															avatar: c.properties.properties?.icon,
															global_name: c.properties.properties?.name,
														} as any
													}
													status={PresenceUpdateStatus.Online as any}
													guild
												/>
											))}
									</Dropdown>
								) : (
									f.guilds?.map((c) => (
										<Contact
											// style={{
											// 	display: search
											// 		? guilds?.map((d) => d.id).includes(c.id)
											// 			? ""
											// 			: "none"
											// 		: "",
											// }}
											format=".webp?size=256"
											onDoubleClick={() => {
												const memberReady = DiscordUtil.getMembership(c);
												if (!memberReady) throw new Error("member not found??");
												const member = new Member(memberReady);
												const channels = c.properties.channels
													.filter((c) => c.type === ChannelType.GuildText)
													.sort((a, b) => a.position - b.position)
													.map((c) => new Channel(c as any));
												const channel = channels.find((c) =>
													hasPermission(
														computePermissions(member, c),
														PermissionFlagsBits.ViewChannel,
													),
												);
												if (!channel) return;
												doubleClick(channel.properties);
											}}
											key={c.properties.id}
											user={
												{
													id: c.properties.id,
													avatar: c.properties.properties?.icon,
													global_name: c.properties.properties?.name,
												} as any
											}
											status={PresenceUpdateStatus.Online as any}
											guild
										/>
									))
								),
							)}
						</Dropdown>
						<Dropdown header="Offline" info={`(${offline.length})`}>
							{offlineUnsearched?.map((c) => (
								<Contact
									style={{
										display: search
											? offline?.map((d) => d.user?.id).includes(c.user?.id)
												? ""
												: "none"
											: "",
									}}
									onDoubleClick={() => doubleClick(c.user)}
									onContextMenu={(e) => contactContextMenu(c.user, e)}
									key={c.user?.id}
									{...c}
								/>
							))}
						</Dropdown>
					</div>
				</div>
				<div className={styles.bottom}>
					<div className={styles.divider} />
					<NewsWidget />
					<div className={styles.dividerAlt} />
					<div className={styles.aboveAd}>
						<ImageButton
							onClick={() => window.open("https://www.msn.com", "_blank")}
							type="msn"
						/>
						<ImageButton
							onClick={() =>
								window.open("https://discord.gg/nP9SxVQGnu", "_blank")
							}
							type="discord"
						/>
					</div>
					<img
						width={234}
						height={60}
						src={ad?.src}
						onClick={() => {
							intervalFn();
							if (!ad?.href || !ad?.href.startsWith("http")) return;
							window.open(ad.href, "_blank");
						}}
						className={styles.ad}
					/>
				</div>
			</div>
		</div>
	);
}

export default Home;
