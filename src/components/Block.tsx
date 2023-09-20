import { BaseTexture, ISpritesheetData, Spritesheet } from 'pixi.js';
import { useState, useEffect, useRef } from 'react';
import { AnimatedSprite, Container, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { data as f1SpritesheetData } from '../../convex/data/spritesheets/f1';
import { map } from '../../convex/data/world';

export const Block = ({ x, y, onClick }: { x: number; y: number; onClick: () => void }) => {
  // The first "left" is "right" but reflected.
  const tileDim = map.tileDim;

  // Prevents the animation from stopping when the texture changes
  // (see https://github.com/pixijs/pixi-react/issues/359)
  const ref = useRef<PIXI.AnimatedSprite | null>(null);

  return (
    <Container
      x={x * tileDim + tileDim / 2}
      y={y * tileDim + tileDim / 2}
      interactive={true}
      pointerdown={onClick}
      cursor="pointer"
    >
      <Text text={'📦'} scale={{ x: 1, y: 1 }} anchor={{ x: 0.5, y: 0.5 }} />
    </Container>
  );
};
