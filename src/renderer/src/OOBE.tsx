import styles from "@renderer/css/OOBE/Welcome.module.css";
import { createWindow } from "./util/ipc";
const remote = window.require(
    "@electron/remote",
) as typeof import("@electron/remote");
const Store = window.require(
    "electron-store",
) as typeof import("electron-store");
import CommandLink from "./components/CommandLink";

const win = remote.getCurrentWindow();
win.setMinimumSize(612, 526);
win.setMaximumSize(612, 526);
win.setTitle("WLMcord Setup");

export default function OOBE() {
    return (
        <div className={styles.container}>
            <h1>Welcome to WLMcord!</h1>
            <div>
                This wizard will help you customize your WLMcord experience like you want it to.
            </div>
            <div>
                Click Next to continue.
            </div>
            <button>
                Next
            </button>
        </div>
        
    );
}