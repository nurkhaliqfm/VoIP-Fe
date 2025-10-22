import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import axios from "axios";
import { MdBedroomChild } from "react-icons/md";
import { BsPersonBadge } from "react-icons/bs";
import { FaMicrophone, FaMicrophoneSlash, FaPhone } from "react-icons/fa6";
import { TbPhoneEnd } from "react-icons/tb";

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

const API_BASE_URL = "https://89qrngt0-3005.asse.devtunnels.ms";
// const API_BASE_URL = "http://localhost:3005";

function App() {
	const [socket, setSocket] = useState<Socket | null>(null);
	const [callStatus, setCallStatus] = useState("Ready");
	const [connectionStatus, setConnectionStatus] = useState("Not connected");
	const [isMicrophoneMuted, setIsMicrophoneMuted] = useState(false);

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

			socket.emit(
				"register",
				name,
				type,
				(callback: {
					success: boolean;
					message: string;
					socket: {
						id: string;
						user: string;
						type: "guest" | "receptionist";
					};
				}) => {
					if (callback.success) {
						saveToLocalStorage({
							id: callback.socket.id,
							user: callback.socket.user,
							type: callback.socket.type,
						});
					} else {
						console.error("Registration failed:", callback.message);
					}
				}
			);
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

		console.log("Connecting to signaling server...", socketConnection);

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
				socketConnection.emit("iceCandidate", {
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

		socketConnection.on("incomingCall", async ({ from, offer }) => {
			peerSocketIdRef.current = from;
			setCallStatus("Incoming call...");

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
				socketConnection.emit("answer", { to: from, answer });

				setCallStatus("In Call");
			} catch (error) {
				console.error("Error handling incoming call:", error);
				setCallStatus("Call failed");
			}
		});

		socketConnection.on("callAnswered", async ({ answer }) => {
			try {
				await pc.setRemoteDescription(answer);
				setCallStatus("In Call");
			} catch (error) {
				console.error("Error handling call answer:", error);
			}
		});

		socketConnection.on("iceCandidate", async ({ candidate }) => {
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

	const startCall = async ({
		from,
		from_type,
		to,
		to_type,
	}: {
		from: string;
		from_type: string;
		to: string;
		to_type: string;
	}) => {
		if (!socket || !pcRef.current) return;

		try {
			setCallStatus("Starting call...");

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

			socket.emit("call", { from, from_type, to, to_type, offer });
			setCallStatus("Calling " + to + "...");
		} catch (error) {
			console.error("Error starting call:", error);
			setCallStatus("Call failed");
		}
	};

	const endCall = () => {
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
					socket.emit("iceCandidate", {
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
		setCallStatus("Ready");

		if (localAudioRef.current) {
			localAudioRef.current.srcObject = null;
		}
		if (remoteAudioRef.current) {
			remoteAudioRef.current.srcObject = null;
		}
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
				{getFromLocalStorage() !== null && callStatus !== "In Call" && (
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
													startCall({
														from: getFromLocalStorage()!.user,
														from_type: "guest",
														to: receptionist.slug,
														to_type: "receptionist",
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
													startCall({
														from: getFromLocalStorage()!.user,
														from_type: "receptionist",
														to: room.slug,
														to_type: "guest",
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
					<div className="bg-green-600 rounded-2xl text-white px-4 py-2 flex flex-col min-w-24">
						<span className="text-xs text-start font-light">Status :</span>
						<p className="font-semibold text-start">{callStatus}</p>
						<div className="flex flex-col items-center gap-2">
							<audio
								ref={remoteAudioRef}
								autoPlay
								muted={isMicrophoneMuted}
								className="hidden"></audio>

							{callStatus === "In Call" && (
								<div className="flex mt-4 gap-x-4">
									<div className="rounded-full bg-white text-black p-3 cursor-pointer">
										{isMicrophoneMuted ? (
											<FaMicrophoneSlash
												onClick={() => setIsMicrophoneMuted(false)}
											/>
										) : (
											<FaMicrophone
												onClick={() => setIsMicrophoneMuted(true)}
											/>
										)}
									</div>
									<button
										className="rounded-full bg-red-600 text-white p-3 cursor-pointer "
										onClick={endCall}
										disabled={callStatus !== "In Call"}>
										<TbPhoneEnd />
									</button>
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

export default App;
