import React, {useMemo, useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {BookHeart, BookOpenText, Library, Settings} from 'lucide-react-native';
import type {Book, ConceptCard} from '../../domain/models';
import type {Repositories} from '../../data/repositories';
import type {DeepSeekSettings} from '../../settings/secureSettings';
import type {TtsPreferences} from '../../settings/ttsPreferences';
import type {TtsService} from '../../tts/offlineTts';
import {createGenerationCoordinator} from '../generationCoordinator';
import FavoritesScreen from '../screens/FavoritesScreen';
import LibraryScreen from '../screens/LibraryScreen';
import ReaderScreen from '../screens/ReaderScreen';
import SettingsScreen from '../screens/SettingsScreen';
import {colors} from '../theme';

type RootTabParamList = {
  Library: undefined;
  Reader: {bookId: string | null; initialCardId: string | null} | undefined;
  Favorites: undefined;
  Settings: undefined;
};

export interface AppDependencies {
  repositories: Pick<Repositories,
    'listBooks' | 'listCards' | 'listOutlineNodes' | 'getLastReadCard' | 'getBook' |
    'setLastReadCard' | 'toggleFavorite' | 'listFavoriteCards' | 'getGenerationState' |
    'getCardScrollOffset' | 'setCardScrollOffset'>;
  pickBookUri(): Promise<string>;
  importBook(uri: string): Promise<Book>;
  generateNextSection(bookId: string, afterSectionId?: string): Promise<unknown>;
  generateSection(sectionId: string): Promise<unknown>;
  getDeepSeekSettings(): Promise<DeepSeekSettings>;
  setDeepSeekSettings(settings: DeepSeekSettings): Promise<void>;
  getTtsPreferences(): Promise<TtsPreferences>;
  setTtsPreferences(settings: TtsPreferences): Promise<void>;
  tts: TtsService;
}

interface Props {dependencies: AppDependencies}

const Tab = createBottomTabNavigator<RootTabParamList>();

const tabIcons = {
  Library,
  Reader: BookOpenText,
  Favorites: BookHeart,
  Settings,
};

const tabLabels = {Library: '书库', Reader: '阅读', Favorites: '收藏', Settings: '设置'} as const;

function createTabIcon(name: keyof typeof tabIcons) {
  const Icon = tabIcons[name];
  return ({color, size}: {color: string; size: number}) => <Icon color={color} size={Math.min(size, 22)} />;
}

export default function AppNavigator({dependencies}: Props) {
  const [generationRevision, setGenerationRevision] = useState(0);
  const coordinator = useMemo(
    () => createGenerationCoordinator(dependencies.generateNextSection, dependencies.generateSection),
    [dependencies.generateNextSection, dependencies.generateSection],
  );
  const libraryDependencies = useMemo(() => ({
    repositories: dependencies.repositories,
    pickBookUri: dependencies.pickBookUri,
    importBook: dependencies.importBook,
  }), [dependencies]);
  const readerDependencies = useMemo(() => ({
    repositories: dependencies.repositories,
    generationCoordinator: coordinator,
    tts: dependencies.tts,
  }), [coordinator, dependencies.repositories, dependencies.tts]);
  const settingsDependencies = useMemo(() => ({
    getDeepSeekSettings: dependencies.getDeepSeekSettings,
    setDeepSeekSettings: dependencies.setDeepSeekSettings,
    getTtsPreferences: dependencies.getTtsPreferences,
    setTtsPreferences: dependencies.setTtsPreferences,
    preloadTts: dependencies.tts.preload,
  }), [dependencies]);

  return (
    <NavigationContainer>
      <Tab.Navigator
        initialRouteName="Library"
        backBehavior="history"
        screenOptions={({route}) => {
          return {
            headerShown: false,
            animation: 'none' as const,
            tabBarLabel: tabLabels[route.name],
            tabBarAccessibilityLabel: tabLabels[route.name],
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.muted,
            tabBarStyle: {height: 60, borderTopColor: colors.border, backgroundColor: colors.surface},
            tabBarLabelStyle: {fontSize: 11, paddingBottom: 4},
            tabBarIcon: createTabIcon(route.name),
          };
        }}>
        <Tab.Screen name="Library">
          {({navigation}) => (
            <LibraryScreen
              dependencies={libraryDependencies}
              onOpenBook={bookId => navigation.navigate('Reader', {bookId, initialCardId: null})}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Reader" initialParams={{bookId: null, initialCardId: null}}>
          {({route}) => (
            <ReaderScreen
              bookId={route.params?.bookId ?? null}
              initialCardId={route.params?.initialCardId ?? null}
              generationRevision={generationRevision}
              dependencies={readerDependencies}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Favorites">
          {({navigation}) => (
            <FavoritesScreen
              repositories={dependencies.repositories}
              onOpenCard={(card: ConceptCard) => navigation.navigate('Reader', {bookId: card.bookId, initialCardId: card.id})}
            />
          )}
        </Tab.Screen>
        <Tab.Screen name="Settings">
          {() => <SettingsScreen dependencies={settingsDependencies} onSaved={() => setGenerationRevision(value => value + 1)} />}
        </Tab.Screen>
      </Tab.Navigator>
    </NavigationContainer>
  );
}
