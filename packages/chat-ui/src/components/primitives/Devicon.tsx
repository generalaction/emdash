import { deviconAdapter } from './devicon.css';

export type DeviconProps = {
  iconClass: string;
  size?: number;
};

/** Solid adapter that contains Devicon's foreign font class beneath an owned root. */
export function Devicon(props: DeviconProps) {
  const size = () => props.size ?? 12;

  return (
    <span
      class={deviconAdapter}
      style={{ '--_chat-devicon-size': `${size()}px` }}
      data-foreign-adapter="devicon"
      aria-hidden="true"
    >
      <i class={props.iconClass} />
    </span>
  );
}
