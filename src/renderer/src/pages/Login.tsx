import styles from "@renderer/css/pages/Login.module.css";
import { ChangeEvent, useContext, useEffect, useRef, useState } from "react";
import Vibrant from "node-vibrant";
import pfp from "@renderer/assets/login/sample-pfp.png";
import { closeGateway, startGateway } from "@renderer/util/ipc";
import { Context } from "@renderer/util";
const remote = window.require(
	"@electron/remote",
) as typeof import("@electron/remote");
const Store = window.require(
	"electron-store",
) as typeof import("electron-store");
import speen from "@renderer/assets/login/speen.png";

function hexToPixelImage(hexCode: string) {
	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = hexCode;
	ctx.globalAlpha = 0.25;
	ctx.fillRect(0, 0, 1, 1);
	const d = canvas.toDataURL();
	return d;
}

const SecurePassword = ({
	value,
	onChange,
	mask = "*",
	placeholder = "",
	className = "",
	id,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	mask?: string;
	placeholder?: string;
	className?: string;
}) => {
	let updatePass = (e: ChangeEvent<HTMLInputElement>) => {
		let newValue = e.target.value;
		// Account for multi-character unicode masks
		let newLength = newValue.length / mask.length;
		let oldLength = value.length * mask.length;

		// NOTE: This assumes all edits happen at the end of the password.
		// To support mid word character adding, we can find the current cursor position using refs
		// The idea is to determine the start and stop based on the cursor position to slice the newValue and splice it into value at the same spot. It's complicated by the emoji support since those have length > 1

		// We've added characters at the end
		if (value.length < newLength) onChange(value + newValue.slice(oldLength));

		// We've removed characters from the end
		if (value.length > newLength) onChange(value.slice(0, newLength));
	};

	return (
		<input
			id={id}
			value={mask.repeat(value.length)}
			onKeyDown={(e) => {
				// prevent arrow keys from moving the cursor
				if (e.key.startsWith("Arrow")) e.preventDefault();
			}}
			onMouseDown={(e) => {
				if (e.target === document.activeElement) e.preventDefault();
			}}
			onChange={updatePass}
			placeholder={placeholder}
			className={className}
		/>
	);
};

function isTokenPotentiallyValid(token: string): boolean {
	if (token.split(".").length !== 3) return false;
	try {
		const decoded = atob(token.split(".")[0]);
		return decoded.length > 16;
	} catch {
		return false;
	}
}

interface IUser {
	accent_color: string | null;
	avatar: string | null;
	avatar_decoration: string | null;
	desktop: boolean;
	discriminator: string;
	display_name: string;
	email: string;
	flags: any;
	global_name: string;
	id: string;
	mfa_enabled: boolean;
	mobile: boolean;
	nsfw_allowed: boolean;
	phone: string;
	premium: boolean;
	premium_type: number;
	premium_usage_flags: number;
	public_flags: any;
	purchased_flags: number;
	username: string;
	system: boolean;
	verified: boolean;
	bot: boolean;
	theme_colors: number[];
}

const store = new Store();

function tryGetToken(): string {
	try {
		return remote.safeStorage.isEncryptionAvailable()
			? store.get("token")
				? remote.safeStorage.decryptString(
						Buffer.from((store.get("token") as any) || ""),
				  )
				: ""
			: "";
	} catch {
		return "";
	}
}

function Login(): JSX.Element {
	const [saveToken, setSaveToken] = useState(false);
	const [autoLogin, setAutoLogin] = useState(false);
	const [clicked, setClicked] = useState(false);
	const [password, setPassword] = useState("");
	const [confirmed, setConfirmed] = useState(store.get("confirmed") || false);
	const [mfaCode, setMfaCode] = useState("");
	const [email, setEmail] = useState("");
	const [checkedAutoLogin, setCheckedAutoLogin] = useState(false);
	const [error, setError] = useState("");
	const [captcha, setCaptcha] = useState(false);
	const [ticket, setTicket] = useState("");
	const [mfa, setMfa] = useState(false);
	const { state, setState } = useContext(Context);
	useEffect(() => {
		if (checkedAutoLogin) return;
		setCheckedAutoLogin(true);
		if (store.get("autoLogin")) {
			(document.getElementById("save-token") as HTMLInputElement).checked =
				true;
			setSaveToken(true);
			setAutoLogin(true);
			// we need to get and decrypt the token ourselves from the store
			const token = tryGetToken();
			console.log(token);
			startGateway(token);
			setState({ ...state, token });
			setClicked(true);
		}
	}, [checkedAutoLogin, state]);
	useEffect(() => {
		store.set("confirmed", true);
	}, []);
	const pfpRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		store.set("autoLogin", autoLogin);
	}, [autoLogin]);
	useEffect(() => {
		const timeout = setTimeout(() => {
			if (!clicked) return;
			setClicked(false);
			closeGateway();
			setState({} as any);
			setError(
				"We were unable to sign you in. Please make sure you token/email and password are correct.",
			);
			setPassword("");
		}, 10000);
		return () => clearTimeout(timeout);
	}, [clicked]);
	return (
		<div className={styles.window}>
			<div className={styles.pfp} ref={pfpRef} />
			<div className={styles.heading}>
				{clicked ? "Signing in..." : "Sign in"}
			</div>
			<div className={styles.content}>
				<div
					className={styles.hero}
					style={{
						display: clicked ? "none" : undefined,
					}}
				>
					Sign in with your Discord account. Don't have an account?{" "}
					<a href="https://discord.com/login" target="_blank">
						Create one.
					</a>
				</div>
				{/* <div className={styles.hero}>
					Sign in with your Windows Live ID. Don't have one? Sign up.
				</div> */}
				{!confirmed && !clicked && (
					<div className={styles.warning}>
						By using WLMcord, you accept a small (but non-zero) risk that your
						account may be banned. With this in mind, WLMcord has not had any
						users banned from Discord.
					</div>
				)}
				<div
					className={styles.form}
					style={{
						display: clicked ? "none" : undefined,
					}}
				>
					{!captcha && (
						<input
							style={{
								marginBottom: 2,
							}}
							type="email"
							placeholder="Email"
							onChange={(e) => setEmail(e.currentTarget.value)}
						/>
					)}
					<SecurePassword
						id="token"
						placeholder={captcha ? "Token" : "Password"}
						value={password}
						onChange={(e) => {
							setPassword(e);
							if (captcha) {
								if (isTokenPotentiallyValid(e)) {
									setError("");
								} else {
									setError("Invalid token.");
								}
							}
						}}
					/>
					{mfa && (
						<input
							style={{
								marginTop: 2,
							}}
							type="number"
							placeholder="MFA Code"
							onChange={(e) => setMfaCode(e.currentTarget.value)}
						/>
					)}
					{error && <div className={styles.error}>{error}</div>}
					{/* (userInfo?.id ? (
					<div>
						This token will sign you in as:{" "}
						<b>{userInfo?.global_name || userInfo?.username}</b>
						<div className={styles.footer}>
							Your token will be securely encrypted on disk for future logins.
						</div>
					</div>
					) ) : (
					<div>
						<a
							target="_blank"
							href="https://www.androidauthority.com/get-discord-token-3149920/"
						>
							How do I get my Discord token?
						</a>
					</div>
					) */}
					<div className={styles.checkInput}>
						<input
							disabled={clicked || !remote.safeStorage.isEncryptionAvailable()}
							id="save-token"
							className={styles.check}
							type="checkbox"
							onChange={(e) => {
								setSaveToken(e.target.checked);
								if (!e.target.checked) {
									(
										document.getElementById("auto-login") as HTMLInputElement
									).checked = false;
									setAutoLogin(false);
								}
							}}
							defaultChecked={!!store.get("token")}
						/>
						<label htmlFor="save-token">Remember me</label>
						<a
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
								store.delete("token");
								setPassword("");
								(
									document.getElementById("save-token") as HTMLInputElement
								).checked = false;

								remote.dialog.showMessageBoxSync(remote.getCurrentWindow(), {
									message: "Forgotten",
									title: "Windows Live Messenger",
									detail: "Your token has been forgotten.",
									type: "info",
									noLink: true,
								});
							}}
						>
							(Forget me)
						</a>
					</div>
					<div className={styles.checkInput}>
						<input
							disabled={
								!saveToken || !remote.safeStorage.isEncryptionAvailable()
							}
							id="auto-login"
							className={styles.check}
							type="checkbox"
							onChange={(e) => setAutoLogin(e.target.checked)}
							defaultChecked={!!store.get("token")}
						/>
						<label htmlFor="auto-login">Automatically log me in</label>
					</div>
				</div>
				<img
					src={speen}
					className={styles.speen}
					style={{
						display: clicked ? undefined : "none",
					}}
				/>
				{captcha ? (
					<button
						onClick={() => {
							if (clicked) {
								closeGateway();
								setState({} as any);
								setClicked(false);
							} else {
								const token = password;
								startGateway(token);
								setState({ ...state, token });
								setClicked(true);
								const save = (
									document.getElementById("save-token") as HTMLInputElement
								)?.checked;
								if (save) {
									store.set("token", remote.safeStorage.encryptString(token));
								} else {
									store.delete("token");
								}
							}
						}}
						disabled={!password || !isTokenPotentiallyValid(password)}
						className={styles.signIn}
					>
						Sign in
					</button>
				) : (
					<button
						disabled={
							!email || !password || !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
						}
						onClick={async () => {
							if (clicked) {
								closeGateway();
								setState({} as any);
								setClicked(false);
							} else {
								let res: any;
								let token: string = "";
								if (mfa) {
									res = await (
										await fetch("https://discord.com/api/v9/auth/mfa/totp", {
											headers: {
												"Content-Type": "application/json",
											},
											method: "POST",
											body: JSON.stringify({
												code: mfaCode,
												ticket,
											}),
										})
									).json();
									token = res.token;
								} else {
									res = await (
										await fetch("https://discord.com/api/v9/auth/login", {
											headers: {
												"Content-Type": "application/json",
											},
											method: "POST",
											body: JSON.stringify({
												email,
												password,
											}),
										})
									).json();
								}
								if (res?.mfa) {
									setMfa(true);
									setTicket(res.ticket);
									setCaptcha(false);
									setError("");
									return;
								}
								if (res?.code === 50035) {
									setError("Invalid email or password.");
									return;
								}
								if (!token) {
									setCaptcha(true);
									(document.getElementById("token") as HTMLInputElement).value =
										"";
									setPassword("");
									setError(
										"Unfortunately, a captcha was presented to you; please login with your token instead.",
									);
									return;
								}
								startGateway(token);
								setState({ ...state, token });
								setClicked(true);
								const save = (
									document.getElementById("save-token") as HTMLInputElement
								)?.checked;
								if (save) {
									store.set("token", remote.safeStorage.encryptString(token));
								} else {
									store.delete("token");
								}
							}
						}}
						className={styles.signIn}
					>
						{clicked ? "Cancel" : "Sign in"}
					</button>
				)}
			</div>
			<div className={styles.windowFooter}>
				<a href="https://discord.gg/Upbs6CXRm4" target="_blank">
					Join our Discord server!
				</a>
				{" | "}
				<div>made by notnullptr & mapliee</div>
			</div>
		</div>
	);
}

export default Login;
