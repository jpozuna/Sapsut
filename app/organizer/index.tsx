import { Redirect } from 'expo-router';

export default function OrganizerIndex() {
  return <Redirect href="/organizer/create-task" />;
}
