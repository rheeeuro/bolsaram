import BolsaramApp from "../../BolsaramApp";

export default function RoomPage({ params }) {
  return <BolsaramApp initialRoomId={params.roomId} />;
}
