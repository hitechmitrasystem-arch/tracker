import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View
} from 'react-native';

const STORAGE_KEY = 'nofap_tracker_state_v1';

const QUOTES = [
  'Discipline is doing what must be done, even when no one is watching.',
  'Control your mind, or your mind controls you.',
  'Today is earned, not given.',
  'Strength grows in silence and consistency.',
  'Every clean day builds the man you are becoming.'
];

const HARD_MODE_QUOTES = [
  'Hard Mode: No excuses. Restart. Rebuild. Return stronger.',
  'A reset is not defeat; it is a direct order to tighten discipline.',
  'Stand up immediately. Zero compromise. Zero delay.'
];

const todayKey = () => new Date().toISOString().slice(0, 10);

const formatDate = (isoDate) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

const dateKey = (date) => date.toISOString().slice(0, 10);

const getHeatColor = (value) => {
  if (value === 'clean') {
    return '#2ea043';
  }
  if (value === 'relapse') {
    return '#f85149';
  }
  return '#30363d';
};

const getYearDays = (year) => {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  const days = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  return days;
};

const buildWeeks = (year) => {
  const days = getYearDays(year);
  const weeks = [];
  let currentWeek = Array(7).fill(null);

  days.forEach((day) => {
    const dayOfWeek = day.getDay();
    currentWeek[dayOfWeek] = new Date(day);

    if (dayOfWeek === 6) {
      weeks.push(currentWeek);
      currentWeek = Array(7).fill(null);
    }
  });

  if (currentWeek.some(Boolean)) {
    weeks.push(currentWeek);
  }

  return weeks;
};

const parseMonth = (dateString) => dateString.slice(0, 7);

const calculateStats = (records) => {
  const entries = Object.entries(records);
  const cleanDays = entries.filter(([, value]) => value === 'clean').length;
  const relapseDays = entries.filter(([, value]) => value === 'relapse').length;
  const total = cleanDays + relapseDays;

  const monthlyMap = {};
  entries.forEach(([day, status]) => {
    const month = parseMonth(day);
    if (!monthlyMap[month]) {
      monthlyMap[month] = { clean: 0, relapse: 0 };
    }
    monthlyMap[month][status] += 1;
  });

  return {
    cleanDays,
    relapseDays,
    successRate: total ? Math.round((cleanDays / total) * 100) : 0,
    monthlyBreakdown: Object.entries(monthlyMap).sort(([a], [b]) => a.localeCompare(b))
  };
};

const calculateCurrentStreak = (records) => {
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (true) {
    const key = dateKey(cursor);
    if (records[key] === 'clean') {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }

  return streak;
};

const calculateLongestStreak = (records) => {
  const sorted = Object.keys(records).sort();
  let longest = 0;
  let current = 0;
  let prevDate = null;

  sorted.forEach((day) => {
    const status = records[day];
    const parsed = new Date(`${day}T00:00:00`);

    if (status !== 'clean') {
      current = 0;
      prevDate = parsed;
      return;
    }

    if (!prevDate) {
      current = 1;
    } else {
      const diffDays = Math.round((parsed - prevDate) / (1000 * 60 * 60 * 24));
      current = diffDays === 1 ? current + 1 : 1;
    }

    prevDate = parsed;
    longest = Math.max(longest, current);
  });

  return longest;
};

function MetricCard({ label, value }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function Heatmap({ records, year }) {
  const weeks = useMemo(() => buildWeeks(year), [year]);

  return (
    <View style={styles.heatmapWrapper}>
      <Text style={styles.sectionTitle}>Yearly Discipline Map ({year})</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.heatmapRow}>
          {weeks.map((week, weekIndex) => (
            <View key={`week-${weekIndex}`} style={styles.weekColumn}>
              {week.map((day, dayIndex) => {
                if (!day) {
                  return <View key={`empty-${weekIndex}-${dayIndex}`} style={[styles.dayCell, styles.emptyCell]} />;
                }

                const key = dateKey(day);
                const value = records[key];
                return <View key={key} style={[styles.dayCell, { backgroundColor: getHeatColor(value) }]} />;
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={styles.legendRow}>
        <Text style={styles.legendText}>No data</Text>
        <View style={[styles.legendDot, { backgroundColor: '#30363d' }]} />
        <Text style={styles.legendText}>Clean</Text>
        <View style={[styles.legendDot, { backgroundColor: '#2ea043' }]} />
        <Text style={styles.legendText}>Relapse</Text>
        <View style={[styles.legendDot, { backgroundColor: '#f85149' }]} />
      </View>
    </View>
  );
}

export default function App() {
  const [records, setRecords] = useState({});
  const [hardMode, setHardMode] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [loaded, setLoaded] = useState(false);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loadState = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!stored) {
          setLoaded(true);
          return;
        }

        const parsed = JSON.parse(stored);
        setRecords(parsed.records || {});
        setHardMode(Boolean(parsed.hardMode));
      } catch {
        // If data is corrupted, start clean.
        setRecords({});
      } finally {
        setLoaded(true);
      }
    };

    loadState();
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        records,
        hardMode
      })
    );
  }, [records, hardMode, loaded]);

  const streak = useMemo(() => calculateCurrentStreak(records), [records]);
  const longestStreak = useMemo(() => calculateLongestStreak(records), [records]);
  const stats = useMemo(() => calculateStats(records), [records]);
  const today = todayKey();

  useEffect(() => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 1.12,
        duration: 140,
        useNativeDriver: true
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true
      })
    ]).start();
  }, [streak, scaleAnim]);

  const markToday = (status) => {
    setRecords((prev) => ({
      ...prev,
      [today]: status
    }));
  };

  const onCleanPress = () => {
    markToday('clean');
  };

  const onRelapsePress = () => {
    Alert.alert('Confirm Relapse', 'Mark today as relapse and reset your streak?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: hardMode ? 'Reset to Zero' : 'Confirm',
        style: 'destructive',
        onPress: () => {
          markToday('relapse');
          if (hardMode) {
            Alert.alert('Hard Mode', HARD_MODE_QUOTES[new Date().getDate() % HARD_MODE_QUOTES.length]);
          }
        }
      }
    ]);
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading offline tracker...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setActiveTab('home')}
          style={[styles.tabButton, activeTab === 'home' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabText, activeTab === 'home' && styles.tabTextActive]}>Home</Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('stats')}
          style={[styles.tabButton, activeTab === 'stats' && styles.tabButtonActive]}
        >
          <Text style={[styles.tabText, activeTab === 'stats' && styles.tabTextActive]}>Statistics</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {activeTab === 'home' ? (
          <>
            <Text style={styles.dateText}>{formatDate(today)}</Text>

            <Animated.Text style={[styles.streakValue, { transform: [{ scale: scaleAnim }] }]}>{streak}</Animated.Text>
            <Text style={styles.streakLabel}>Current Streak</Text>

            <Text style={styles.longestText}>Longest Streak: {longestStreak} days</Text>

            <View style={styles.actionsRow}>
              <Pressable style={[styles.primaryButton, styles.cleanButton]} onPress={onCleanPress}>
                <Text style={styles.primaryButtonText}>I Stayed Clean Today</Text>
              </Pressable>

              <Pressable style={[styles.primaryButton, styles.relapseButton]} onPress={onRelapsePress}>
                <Text style={styles.primaryButtonText}>Mark Relapse</Text>
              </Pressable>
            </View>

            <View style={styles.quoteCard}>
              <Text style={styles.sectionTitle}>Motivation</Text>
              <Text style={styles.quoteText}>{QUOTES[new Date().getDate() % QUOTES.length]}</Text>
            </View>

            <View style={styles.hardModeCard}>
              <View>
                <Text style={styles.sectionTitle}>Extra Discipline: Hard Mode</Text>
                <Text style={styles.subtleText}>Relapse triggers zero-compromise reset messaging.</Text>
              </View>
              <Switch
                value={hardMode}
                onValueChange={setHardMode}
                trackColor={{ false: '#30363d', true: '#2ea043' }}
                thumbColor="#0d1117"
              />
            </View>

            <Heatmap records={records} year={new Date().getFullYear()} />
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Statistics</Text>
            <View style={styles.metricsRow}>
              <MetricCard label="Total Clean" value={stats.cleanDays} />
              <MetricCard label="Total Relapse" value={stats.relapseDays} />
            </View>
            <MetricCard label="Success Rate" value={`${stats.successRate}%`} />

            <View style={styles.quoteCard}>
              <Text style={styles.sectionTitle}>Monthly Breakdown</Text>
              {stats.monthlyBreakdown.length === 0 ? (
                <Text style={styles.subtleText}>No entries yet. Start your first clean day today.</Text>
              ) : (
                stats.monthlyBreakdown.map(([month, summary]) => (
                  <View key={month} style={styles.monthRow}>
                    <Text style={styles.monthText}>{month}</Text>
                    <Text style={styles.monthText}>✅ {summary.clean} / ❌ {summary.relapse}</Text>
                  </View>
                ))
              )}
            </View>

            <Heatmap records={records} year={new Date().getFullYear()} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117'
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingText: {
    color: '#8b949e',
    fontSize: 16
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8
  },
  tabButton: {
    flex: 1,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center'
  },
  tabButtonActive: {
    borderColor: '#2ea043'
  },
  tabText: {
    color: '#8b949e',
    fontWeight: '600'
  },
  tabTextActive: {
    color: '#2ea043'
  },
  scroll: {
    flex: 1
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 14
  },
  dateText: {
    color: '#8b949e',
    textAlign: 'center',
    marginTop: 6
  },
  streakValue: {
    color: '#2ea043',
    textAlign: 'center',
    fontSize: 68,
    fontWeight: '800',
    marginTop: 10
  },
  streakLabel: {
    color: '#c9d1d9',
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600'
  },
  longestText: {
    color: '#8b949e',
    textAlign: 'center'
  },
  actionsRow: {
    gap: 10,
    marginTop: 10
  },
  primaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center'
  },
  cleanButton: {
    backgroundColor: '#2ea043'
  },
  relapseButton: {
    backgroundColor: '#f85149'
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15
  },
  quoteCard: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderColor: '#30363d',
    borderWidth: 1,
    padding: 14,
    gap: 8
  },
  sectionTitle: {
    color: '#c9d1d9',
    fontWeight: '700',
    fontSize: 16
  },
  quoteText: {
    color: '#8b949e',
    lineHeight: 20
  },
  hardModeCard: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderColor: '#30363d',
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12
  },
  subtleText: {
    color: '#8b949e',
    fontSize: 13,
    marginTop: 2
  },
  heatmapWrapper: {
    backgroundColor: '#161b22',
    borderRadius: 12,
    borderColor: '#30363d',
    borderWidth: 1,
    padding: 14,
    gap: 12
  },
  heatmapRow: {
    flexDirection: 'row',
    gap: 4
  },
  weekColumn: {
    gap: 4
  },
  dayCell: {
    width: 12,
    height: 12,
    borderRadius: 2
  },
  emptyCell: {
    opacity: 0
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8
  },
  legendText: {
    color: '#8b949e',
    fontSize: 12
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 2
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#161b22',
    borderColor: '#30363d',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14
  },
  metricLabel: {
    color: '#8b949e',
    fontSize: 12
  },
  metricValue: {
    color: '#2ea043',
    fontWeight: '800',
    fontSize: 28,
    marginTop: 8
  },
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d'
  },
  monthText: {
    color: '#c9d1d9'
  }
});
