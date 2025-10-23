import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import axios from "axios";
import { MdBedroomChild } from "react-icons/md";
import { BsPersonBadge } from "react-icons/bs";
import { FaPhone } from "react-icons/fa6";
import { TbPhoneEnd } from "react-icons/tb";
import {
	PiMicrophoneFill,
	PiMicrophoneSlashFill,
	PiPhoneIncomingFill,
	PiPhoneSlashFill,
} from "react-icons/pi";

type Room = {
	id: number;
	name: string;
	slug: string;
	floor: number;
	status: "AVAILABLE" | "OCCUPIED" | "CLEANING" | "MAINTENANCE";
	fingerprint: string;
};

type Receptionist = {
	id: number;
	name: string;
	slug: string;
	socket: string;
	updatedAt: string;
};

type CallbackResponse = {
	name: string;
	status: string;
	message: string;
	socket?: { id: string; user: string; type: "guest" | "receptionist" };
};

type SocketData = {
	socket_id: string;
	user: string;
	type: "guest" | "receptionist";
};

const API_BASE_URL = "https://89qrngt0-3005.asse.devtunnels.ms";
// const API_BASE_URL = "http://localhost:3005";

function App() {
	const [socket, setSocket] = useState<Socket | null>(null);
	const [callStatus, setCallStatus] = useState<"" | "offer" | string | null>(
		null
	);
	const [callMessage, setCallMessage] = useState<string | null>(null);
	const [connectionStatus, setConnectionStatus] = useState("Not connected");
	const [isMicrophoneMuted, setIsMicrophoneMuted] = useState(false);
	const [callingData, setCallingData] = useState<{
		to: string;
		type: string;
		from: string;
	} | null>(null);

	const [rooms, setRooms] = useState<Room[]>([]);
	const [receptionists, setReceptionists] = useState<Receptionist[]>([]);

	const remoteAudioRef = useRef<HTMLAudioElement>(null);
	const localAudioRef = useRef<HTMLAudioElement>(null);
	const pcRef = useRef<RTCPeerConnection | null>(null);
	const localStreamRef = useRef<MediaStream | null>(null);
	const peerSocketIdRef = useRef<string | null>(null);

	const handleRegister = useCallback(
		async (name: string, type: "guest" | "receptionist") => {
			if (!socket) return;

			socket.emit("register", name, type, (callback: CallbackResponse) => {
				if (callback.status === "REGISTERED" && callback.socket) {
					saveToLocalStorage({
						id: callback.socket.id,
						user: callback.socket.user,
						type: callback.socket.type,
					});
				} else {
					console.error("Registration failed:", callback.message);
				}
			});
		},
		[socket]
	);

	// LocalStorage helpers
	const saveToLocalStorage = (socketData: {
		id: string;
		user: string;
		type: "guest" | "receptionist";
	}) => {
		localStorage.setItem("voip_socket_data", JSON.stringify(socketData));
	};

	const getFromLocalStorage = (): {
		id: string;
		user: string;
		type: "guest" | "receptionist";
	} | null => {
		const data = localStorage.getItem("voip_socket_data");
		return data ? JSON.parse(data) : null;
	};

	const clearLocalStorage = () => {
		localStorage.removeItem("voip_socket_data");
	};

	// Check localStorage on mount
	useEffect(() => {
		if (socket) {
			const savedData = getFromLocalStorage();
			if (savedData && socket) {
				handleRegister(savedData.user, savedData.type);
			}
		}
	}, [socket, handleRegister]);

	useEffect(() => {
		const fetchRooms = async () => {
			try {
				const response = await axios.get<Room[]>(
					API_BASE_URL + "/api/voip/rooms"
				);
				setRooms(response.data);
			} catch (error) {
				console.error("Error fetching rooms:", error);
			}
		};

		fetchRooms();
	}, []);

	useEffect(() => {
		const fetchReceptionist = async () => {
			try {
				const response = await axios.get<Receptionist[]>(
					API_BASE_URL + "/api/voip/receptionists"
				);
				setReceptionists(response.data);
			} catch (error) {
				console.error("Error fetching rooms:", error);
			}
		};

		fetchReceptionist();
	}, []);

	useEffect(() => {
		// Initialize Socket.IO connection
		const socketConnection = io(API_BASE_URL);
		setSocket(socketConnection);

		// Initialize WebRTC peer connection
		const pc = new RTCPeerConnection({
			iceServers: [],
		});
		pcRef.current = pc;

		// WebRTC event handlers
		pc.ontrack = (event) => {
			if (remoteAudioRef.current) {
				remoteAudioRef.current.srcObject = event.streams[0];
			}
		};

		pc.onicecandidate = (event) => {
			if (event.candidate && peerSocketIdRef.current) {
				socketConnection.emit("call:candidate", {
					to: peerSocketIdRef.current,
					candidate: event.candidate,
				});
			}
		};

		// Socket event handlers
		socketConnection.on("connect", () => {
			setConnectionStatus("Connected");
		});

		socketConnection.on("disconnect", () => {
			setConnectionStatus("Disconnected");
		});

		socketConnection.on(
			"call:initiate",
			async ({
				from,
				to,
				message,
				type,
				status,
			}: {
				from: SocketData;
				to: SocketData;
				type: string;
				message: string;
				status: string;
			}) => {
				peerSocketIdRef.current = from.socket_id;
				setCallStatus(status);
				setCallMessage(message);
				setCallingData({ to: to.socket_id, from: from.socket_id, type: type });
			}
		);

		socketConnection.on(
			"call:reject",
			async ({ from, message }: { from: SocketData; message: string }) => {
				peerSocketIdRef.current = from.socket_id;
				setCallStatus(null);
				setCallMessage(message);
				setCallingData(null);
			}
		);

		socketConnection.on(
			"call:stop",
			async ({ from, message }: { from: SocketData; message: string }) => {
				peerSocketIdRef.current = from.socket_id;
				setCallStatus(null);
				setCallMessage(message);
				setCallingData(null);
			}
		);

		socketConnection.on(
			"call:offer",
			async ({
				from,
				to,
				offer,
				status,
			}: {
				from: SocketData;
				to: SocketData;
				status: string;
				offer: RTCSessionDescriptionInit;
			}) => {
				peerSocketIdRef.current = to.socket_id;

				try {
					const stream = await navigator.mediaDevices.getUserMedia({
						audio: true,
					});
					localStreamRef.current = stream;

					if (localAudioRef.current) {
						localAudioRef.current.srcObject = stream;
					}

					stream.getTracks().forEach((track) => pc.addTrack(track, stream));

					await pc.setRemoteDescription(offer);
					const answer = await pc.createAnswer();
					await pc.setLocalDescription(answer);

					socketConnection.emit("call:answer", { to: from.socket_id, answer });
					setCallStatus(status);
					setCallMessage(null);
				} catch (error) {
					console.error("Error handling incoming call:", error);
					setCallStatus("Call failed");
				}
			}
		);

		socketConnection.on("call:answer", async ({ answer, status }) => {
			try {
				await pc.setRemoteDescription(answer);
				setCallStatus(status);
				setCallMessage(null);
			} catch (error) {
				console.error("Error handling call answer:", error);
			}
		});

		socketConnection.on("call:candidate", async ({ candidate }) => {
			try {
				if (candidate) await pc.addIceCandidate(candidate);
			} catch (error) {
				console.error("Error adding ICE candidate:", error);
			}
		});

		// Cleanup on unmount
		return () => {
			socketConnection.disconnect();
			pc.close();
			if (localStreamRef.current) {
				localStreamRef.current.getTracks().forEach((track) => track.stop());
			}
		};
	}, []);

	const resetCallingState = useCallback(() => {
		if (pcRef.current) {
			pcRef.current.close();

			// Reinitialize peer connection
			const pc = new RTCPeerConnection({
				iceServers: [],
			});
			pcRef.current = pc;

			// Re-setup event handlers
			pc.ontrack = (event) => {
				if (remoteAudioRef.current) {
					remoteAudioRef.current.srcObject = event.streams[0];
				}
			};

			pc.onicecandidate = (event) => {
				if (event.candidate && peerSocketIdRef.current && socket) {
					socket.emit("call:candidate", {
						to: peerSocketIdRef.current,
						candidate: event.candidate,
					});
				}
			};
		}

		if (localStreamRef.current) {
			localStreamRef.current.getTracks().forEach((track) => track.stop());
			localStreamRef.current = null;
		}

		peerSocketIdRef.current = null;

		if (localAudioRef.current) {
			localAudioRef.current.srcObject = null;
		}
		if (remoteAudioRef.current) {
			remoteAudioRef.current.srcObject = null;
		}
	}, [socket]);

	const acceptCall = async () => {
		if (!socket || !pcRef.current || callingData === null) return;

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
			});
			localStreamRef.current = stream;

			if (localAudioRef.current) {
				localAudioRef.current.srcObject = stream;
			}

			stream
				.getTracks()
				.forEach((track) => pcRef.current!.addTrack(track, stream));

			const offer = await pcRef.current.createOffer();
			await pcRef.current.setLocalDescription(offer);

			socket.emit("call:offer", {
				to: callingData.from,
				offer,
			});
			setCallMessage(null);
			setCallStatus("offer");
		} catch (error) {
			console.error("Error starting call:", error);
			setCallMessage("Call failed");
			setCallStatus("");
		}
	};

	const initiateCall = ({
		to,
		type,
		name,
	}: {
		to: string;
		type: string;
		name: string;
	}) => {
		if (socket) {
			socket.emit("call:initiate", {
				to,
				type,
			});
		}

		setCallMessage("Calling " + name + "...");
		setCallStatus("calling");
		setCallingData({ to: to, type: type, from: getFromLocalStorage()!.user });
	};

	const rejectCall = () => {
		if (socket && peerSocketIdRef.current) {
			socket.emit("call:reject", {
				to: peerSocketIdRef.current,
			});
		}

		resetCallingState();
		setCallStatus(null);
		setCallMessage(null);
	};

	const stopCalling = () => {
		if (socket && callingData) {
			socket.emit("call:stop", {
				to: callingData.to,
				type: callingData.type,
			});
		}

		resetCallingState();
		setCallStatus(null);
		setCallMessage(null);
	};

	return (
		<section className="max-w-4xl flex flex-col justify-center items-center">
			<div className="flex gap-x-2 justify-center items-center">
				<h1 className="text-2xl font-bold">Local VoIP </h1>
				<div className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-full px-5 py-2.5 shadow-lg border border-gray-200 dark:border-gray-700">
					<div
						className={`w-2.5 h-2.5 rounded-full ${
							connectionStatus === "Connected"
								? "bg-green-500 animate-pulse"
								: "bg-red-500"
						}`}></div>
					<span className="text-sm font-medium text-gray-700 dark:text-gray-300">
						{connectionStatus}
					</span>
				</div>
			</div>
			<button
				className="btn btn-error mb-4 mt-4"
				disabled={getFromLocalStorage() === null}
				onClick={() => {
					clearLocalStorage();
					window.location.reload();
				}}>
				Reset Register
			</button>

			{receptionists && receptionists.length > 0 && (
				<>
					<h2 className="mb-2">Available Receptionists:</h2>
					<div className="flex gap-2 mb-4">
						{receptionists.map((receptionist) => (
							<button
								key={receptionist.slug}
								className={`btn btn-xm w-fit btn-primary`}
								disabled={
									receptionist.socket !== "" || getFromLocalStorage() !== null
								}
								onClick={() =>
									handleRegister(receptionist.slug, "receptionist")
								}>
								<BsPersonBadge /> {receptionist.name}
							</button>
						))}
					</div>
				</>
			)}

			{rooms && rooms.length > 0 && (
				<>
					<h2 className="mb-2">Available Rooms:</h2>
					<div className="flex flex-wrap justify-center items-center gap-2 mb-4">
						{rooms.map((room) => (
							<button
								key={room.slug}
								className={`btn btn-xm w-fit ${
									room.status === "AVAILABLE"
										? "btn-success"
										: room.status === "OCCUPIED"
										? "btn-error"
										: "btn-warning"
								}`}
								disabled={getFromLocalStorage() !== null}
								onClick={() => {
									if (room.status === "AVAILABLE")
										handleRegister(room.slug, "guest");
								}}>
								<MdBedroomChild size={24} /> {room.name}
							</button>
						))}
					</div>
				</>
			)}

			<div className="call-section">
				{getFromLocalStorage() !== null && callStatus !== "answer" && (
					<>
						<h2 className="mb-2">Available Calls:</h2>
						<div className="gap-2 flex flex-col items-center justify-center">
							{getFromLocalStorage()?.type === "guest" && (
								<div className="flex flex-col justify-center items-center w-full">
									<div className="flex gap-2 mb-4">
										{receptionists.map((receptionist) => (
											<button
												key={receptionist.slug}
												className={`btn btn-xm w-fit btn-primary`}
												onClick={() =>
													initiateCall({
														to: receptionist.slug,
														type: "receptionist",
														name: receptionist.name,
													})
												}>
												<FaPhone /> {receptionist.name}
											</button>
										))}
									</div>
								</div>
							)}

							{getFromLocalStorage()?.type === "receptionist" && (
								<div className="flex flex-col justify-center items-center w-full">
									<div className="flex flex-wrap justify-center items-center gap-2 mb-4">
										{rooms.map((room) => (
											<button
												key={room.slug}
												className={`btn btn-xm w-fit ${
													room.status === "AVAILABLE"
														? "btn-success"
														: room.status === "OCCUPIED"
														? "btn-error"
														: "btn-warning"
												}`}
												onClick={() =>
													initiateCall({
														to: room.slug,
														type: "guest",
														name: room.name,
													})
												}>
												<FaPhone size={18} /> {room.name}
											</button>
										))}
									</div>
								</div>
							)}
						</div>
					</>
				)}

				<div className="call-status mt-4 flex flex-col gap-4 items-center justify-center">
					<div className="flex flex-col">
						{callMessage !== null && (
							<div className="bg-green-600 rounded-2xl px-3 py-1">
								<p className="font-semibold text-center">{callMessage}</p>
							</div>
						)}
						<div className="flex justify-center items-center mt-4">
							{callStatus === "calling" ? (
								<button
									className="rounded-full bg-red-600 text-white p-3 cursor-pointer "
									onClick={() => stopCalling()}
									title="Stop Calling">
									<PiPhoneSlashFill />
								</button>
							) : callStatus === "initiate" ? (
								<div className="flex mt-4 gap-x-4">
									<button
										className="rounded-full bg-green-600 text-white p-3 cursor-pointer "
										onClick={acceptCall}
										title="Accept Call">
										<PiPhoneIncomingFill />
									</button>
									<button
										className="rounded-full bg-red-600 text-white p-3 cursor-pointer "
										onClick={rejectCall}
										title="Reject Call">
										<PiPhoneSlashFill />
									</button>
								</div>
							) : null}
						</div>

						<div className="flex flex-col items-center gap-2">
							<audio
								ref={remoteAudioRef}
								autoPlay
								muted={isMicrophoneMuted}
								controls
								className=""></audio>

							{callStatus === "offer" ? (
								<div className="flex mt-4 gap-x-4">
									<div
										className={`rounded-full p-3 cursor-pointer ${
											isMicrophoneMuted
												? "bg-gray-800 text-white"
												: "bg-white text-gray-800"
										}`}>
										{isMicrophoneMuted ? (
											<PiMicrophoneSlashFill
												onClick={() => setIsMicrophoneMuted(false)}
											/>
										) : (
											<PiMicrophoneFill
												onClick={() => setIsMicrophoneMuted(true)}
											/>
										)}
									</div>
									<button
										className="rounded-full bg-red-600 text-white p-3 cursor-pointer "
										// onClick={endCall}
										disabled={callStatus !== "offer"}>
										<TbPhoneEnd />
									</button>
								</div>
							) : (
								callStatus === "answer" && (
									<div className="flex mt-4 gap-x-4">
										<button
											className="rounded-full bg-green-600 text-white p-3 cursor-pointer "
											onClick={acceptCall}
											title="Accept Call">
											<PiPhoneIncomingFill />
										</button>
										<button
											className="rounded-full bg-red-600 text-white p-3 cursor-pointer "
											onClick={rejectCall}
											title="Reject Call">
											<PiPhoneSlashFill />
										</button>
									</div>
								)
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

export default App;
