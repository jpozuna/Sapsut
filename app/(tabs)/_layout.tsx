import { Tabs } from 'expo-router';

import { FloatingTabBar, IconSymbol } from '@/components/ui';
import { useRole } from '@/lib/role-context';

export default function TabLayout() {
  const { role } = useRole();

  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, size }) => (
            <IconSymbol size={size} name="list.bullet" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="organizer"
        options={{
          title: 'Organizer',
          tabBarIcon: ({ color, size }) => (
            <IconSymbol size={size} name="sparkles" color={color} />
          ),
          href: role === 'organizer' ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Ranks',
          tabBarIcon: ({ color, size }) => (
            <IconSymbol size={size} name="trophy.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <IconSymbol size={size} name="gearshape.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
