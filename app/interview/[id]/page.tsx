import InterviewSession from "@/components/interview/InterviewSession";
export default function InterviewPage({ params }: { params: { id: string } }) {
  return <InterviewSession sessionId={params.id} />;
}
