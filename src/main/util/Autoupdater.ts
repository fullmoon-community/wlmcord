import { BrowserWindow, app, dialog } from "electron";
import { join } from "path";
import semver from "semver";
import fs from "fs/promises";
import childProcess from "child_process";

export class Autoupdater {
	static async getLatestReleaseInfo() {
		const tags = await fetch(
			"https://api.github.com/repos/fullmoon-community/wlmcord/tags",
		);
		const tagsJson = await tags.json();
		const latestTag = tagsJson[0].name;
		const release = await fetch(
			`https://api.github.com/repos/fullmoon-community/wlmcord/releases/tags/${latestTag}`,
		);
		const releaseJson = await release.json();
		const [version, description, url]: [string, string, string] = [
			releaseJson.tag_name,
			releaseJson.body,
			releaseJson.assets[0].browser_download_url,
		];
		return { version, description, url };
	}
	static async checkForUpdates(cb?: (type: "success" | "failure") => void) {
		const localVersion = app.getVersion();
		const { version, description, url } = await this.getLatestReleaseInfo();
		if (!semver.gt(version, localVersion)) return;
		cb?.("success");
		const { response } = await dialog.showMessageBox(
			BrowserWindow.getAllWindows()[0],
			{
				type: "question",
				buttons: ["Yes", "No"],
				title: "Update Available",
				message: `A new update is available (local: v${localVersion}, remote: v${version}). Would you like to download it?\nRelease notes:\n\n${description}`,
			},
		);
		if (response !== 0) return;
		const dir = join(app.getPath("temp"), "WLMcord", "Updates");
		await fs.mkdir(dir, { recursive: true });
		const download = await (await fetch(url)).arrayBuffer();
		const update = Buffer.from(download);
		await fs.writeFile(join(dir, "update.exe"), update);
		await dialog.showMessageBox(BrowserWindow.getAllWindows()[0], {
			type: "info",
			buttons: ["Ok"],
			title: "Update Downloaded",
			message: "The update has been downloaded. Press OK to restart.",
		});
		const child = childProcess.spawn(join(dir, "update.exe"), [], {
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		app.quit();
	}
}
