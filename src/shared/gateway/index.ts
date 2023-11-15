import {
	GatewayDispatchEvents,
	GatewayDispatchPayload,
	GatewayOpcodes,
	GatewayReceivePayload,
	GatewaySendPayload,
} from "discord-api-types/v9";
import WebSocket from "ws";

export type DispatchData<T extends GatewayDispatchEvents> =
	(GatewayDispatchPayload & {
		t: T;
	})["d"];

export type OpcodeSendData<T extends GatewayOpcodes> = (GatewaySendPayload & {
	op: T;
})["d"];

export type OpcodeReceiveData<T extends GatewayOpcodes> =
	(GatewayReceivePayload & {
		op: T;
	})["d"];

export function sendOp<T extends GatewayOpcodes>(
	socket: WebSocket,
	opcode: T,
	payload: OpcodeSendData<T>,
): void {
	const data = {
		op: opcode,
		d: payload,
	};

	socket.send(JSON.stringify(data));
}
