import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import HomeView from '@renderer/views/home/HomeView';

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
