import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx, cx } from '@styles/index';
import React from 'react';
import { Combobox } from './combobox';
import * as s from '@react/story-layout.css';
const meta: Meta = {
  title: 'Primitives/Combobox',
  parameters: { layout: 'centered' },
};
export default meta;
type Story = StoryObj;
const FRUITS = ['Apple', 'Banana', 'Cherry', 'Grape', 'Mango', 'Orange', 'Peach', 'Plum'];
const VEGGIES = ['Carrot', 'Celery', 'Pea', 'Spinach', 'Tomato', 'Zucchini'];
export const Default: Story = {
  render: () => (
    <div className={s.w64}>
      <Combobox.Root>
        <Combobox.Input placeholder="Search fruits…" showTrigger showClear />
        <Combobox.Content>
          <Combobox.List>
            {FRUITS.map((fruit) => (
              <Combobox.Item key={fruit} value={fruit}>
                {fruit}
              </Combobox.Item>
            ))}
            <Combobox.Empty>No fruits found.</Combobox.Empty>
          </Combobox.List>
        </Combobox.Content>
      </Combobox.Root>
    </div>
  ),
};

export const StandaloneInput: Story = {
  render: () => (
    <div className={s.w64}>
      <Combobox.Root items={FRUITS}>
        <Combobox.Input appearance="standalone" aria-label="Fruit" placeholder="Search fruits…" />
        <Combobox.Content>
          <Combobox.List>
            {(fruit: string) => (
              <Combobox.Item key={fruit} value={fruit}>
                {fruit}
              </Combobox.Item>
            )}
          </Combobox.List>
          <Combobox.Empty>No fruits found.</Combobox.Empty>
        </Combobox.Content>
      </Combobox.Root>
    </div>
  ),
};

export const WithGroups: Story = {
  render: () => (
    <div className={s.w64}>
      <Combobox.Root>
        <Combobox.Input placeholder="Search foods…" showTrigger showClear />
        <Combobox.Content>
          <Combobox.List>
            <Combobox.Group>
              <Combobox.Label>Fruits</Combobox.Label>
              {FRUITS.map((item) => (
                <Combobox.Item key={item} value={item}>
                  {item}
                </Combobox.Item>
              ))}
            </Combobox.Group>
            <Combobox.Separator />
            <Combobox.Group>
              <Combobox.Label>Vegetables</Combobox.Label>
              {VEGGIES.map((item) => (
                <Combobox.Item key={item} value={item}>
                  {item}
                </Combobox.Item>
              ))}
            </Combobox.Group>
            <Combobox.Empty>Nothing found.</Combobox.Empty>
          </Combobox.List>
        </Combobox.Content>
      </Combobox.Root>
    </div>
  ),
};
export const MultiSelect: Story = {
  render: function Render() {
    const [values, setValues] = React.useState<string[]>([]);
    return (
      <div className={s.w72}>
        <Combobox.Root multiple value={values} onValueChange={setValues}>
          <Combobox.Chips>
            {values.map((v) => (
              <Combobox.Chip key={v}>{v}</Combobox.Chip>
            ))}
            <Combobox.ChipsInput placeholder="Add fruit…" />
          </Combobox.Chips>
          <Combobox.Content>
            <Combobox.List>
              {FRUITS.map((fruit) => (
                <Combobox.Item key={fruit} value={fruit}>
                  {fruit}
                </Combobox.Item>
              ))}
              <Combobox.Empty>No fruits found.</Combobox.Empty>
            </Combobox.List>
          </Combobox.Content>
        </Combobox.Root>
      </div>
    );
  },
};
export const Disabled: Story = {
  render: () => (
    <div className={s.w64}>
      <Combobox.Root disabled>
        <Combobox.Input placeholder="Disabled combobox" showTrigger />
        <Combobox.Content>
          <Combobox.List>
            {FRUITS.map((fruit) => (
              <Combobox.Item key={fruit} value={fruit}>
                {fruit}
              </Combobox.Item>
            ))}
          </Combobox.List>
        </Combobox.Content>
      </Combobox.Root>
    </div>
  ),
};
export const FieldStates: Story = {
  render: () => (
    <div
      className={cx(
        s.w64,
        sx({
          display: 'flex',
          flexDirection: 'column',
          gap: '3',
        })
      )}
    >
      <Combobox.Root>
        <Combobox.Input placeholder="Small warning field" size="sm" tone="warning" />
      </Combobox.Root>
      <Combobox.Root>
        <Combobox.Input placeholder="Invalid field" invalid />
      </Combobox.Root>
      <Combobox.Root>
        <Combobox.Input placeholder="Readonly field" readOnly />
      </Combobox.Root>
    </div>
  ),
};
export const HoverableDisabledItem: Story = {
  render: function Render() {
    const [hovered, setHovered] = React.useState(false);
    return (
      <div className={s.w64}>
        <Combobox.Root defaultOpen>
          <Combobox.Input placeholder="Search agents…" showTrigger />
          <Combobox.Content>
            <Combobox.List>
              <Combobox.Item value="installed">Installed agent</Combobox.Item>
              <Combobox.Item
                value="uninstalled"
                disabled
                hoverableWhenDisabled
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
              >
                Uninstalled agent
              </Combobox.Item>
            </Combobox.List>
          </Combobox.Content>
        </Combobox.Root>
        <div>{hovered ? 'Showing uninstalled agent details' : 'Hover the disabled item'}</div>
      </div>
    );
  },
};
export const ContentAtLeastTriggerWidth: Story = {
  render: () => (
    <div className={s.w48}>
      <Combobox.Root>
        <Combobox.Input placeholder="Search fruits…" showTrigger />
        <Combobox.Content width="content-at-least-trigger">
          <Combobox.List>
            <Combobox.Item value="apple">Apple</Combobox.Item>
            <Combobox.Item value="dragon-fruit">
              Dragon fruit with a much longer display label
            </Combobox.Item>
          </Combobox.List>
        </Combobox.Content>
      </Combobox.Root>
    </div>
  ),
};
