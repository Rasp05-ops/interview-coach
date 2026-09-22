import ReviewPage from "@/components/dashboard/ReviewPage";
export default function ReviewRoute({ params }: { params: { id: string } }) {
  return <ReviewPage sessionId={params.id} />;
}
