import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
} from '../components/combobox';

const meta: Meta = {
  title: 'Components/Combobox',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Grape', 'Mango', 'Orange', 'Peach', 'Plum'];
const VEGGIES = ['Carrot', 'Celery', 'Pea', 'Spinach', 'Tomato', 'Zucchini'];

export const Default: Story = {
  render: () => (
    <div className="w-64">
      <Combobox>
        <ComboboxInput placeholder="Search fruits…" showTrigger showClear />
        <ComboboxContent>
          <ComboboxList>
            {FRUITS.map((fruit) => (
              <ComboboxItem key={fruit} value={fruit}>
                {fruit}
              </ComboboxItem>
            ))}
            <ComboboxEmpty>No fruits found.</ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
};

export const WithGroups: Story = {
  render: () => (
    <div className="w-64">
      <Combobox>
        <ComboboxInput placeholder="Search foods…" showTrigger showClear />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxGroup>
              <ComboboxLabel>Fruits</ComboboxLabel>
              {FRUITS.map((item) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              ))}
            </ComboboxGroup>
            <ComboboxSeparator />
            <ComboboxGroup>
              <ComboboxLabel>Vegetables</ComboboxLabel>
              {VEGGIES.map((item) => (
                <ComboboxItem key={item} value={item}>
                  {item}
                </ComboboxItem>
              ))}
            </ComboboxGroup>
            <ComboboxEmpty>Nothing found.</ComboboxEmpty>
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
};

export const MultiSelect: Story = {
  render: function Render() {
    const [values, setValues] = React.useState<string[]>([]);

    return (
      <div className="w-72">
        <Combobox multiple value={values} onValueChange={setValues}>
          <ComboboxChips>
            {values.map((v) => (
              <ComboboxChip key={v}>{v}</ComboboxChip>
            ))}
            <ComboboxChipsInput placeholder="Add fruit…" />
          </ComboboxChips>
          <ComboboxContent>
            <ComboboxList>
              {FRUITS.map((fruit) => (
                <ComboboxItem key={fruit} value={fruit}>
                  {fruit}
                </ComboboxItem>
              ))}
              <ComboboxEmpty>No fruits found.</ComboboxEmpty>
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div className="w-64">
      <Combobox disabled>
        <ComboboxInput placeholder="Disabled combobox" showTrigger />
        <ComboboxContent>
          <ComboboxList>
            {FRUITS.map((fruit) => (
              <ComboboxItem key={fruit} value={fruit}>
                {fruit}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  ),
};
