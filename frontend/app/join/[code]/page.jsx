import BolsaramApp from "../../BolsaramApp";

export default function JoinPage({ params }) {
  return <BolsaramApp initialInviteCode={params.code} />;
}
