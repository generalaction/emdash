import HomeView from '@renderer/components/HomeView';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';

export function HomeTitlebar() {
  return <Titlebar />;
}

export function HomeMainPanel() {
  return (
    <HomeView
      onOpenProject={() => {}}
      onNewProjectClick={() => {}}
      onCloneProjectClick={() => {}}
      onAddRemoteProject={() => {}}
    />
  );
}

export const homeView = {
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
