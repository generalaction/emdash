import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Box } from '../box';
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
} from './combobox';
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
    <Box className={s.w64}>
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
    </Box>
  ),
};

export const WithGroups: Story = {
  render: () => (
    <Box className={s.w64}>
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
    </Box>
  ),
};

export const MultiSelect: Story = {
  render: function Render() {
    const [values, setValues] = React.useState<string[]>([]);

    return (
      <Box className={s.w72}>
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
      </Box>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <Box className={s.w64}>
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
    </Box>
  ),
};
