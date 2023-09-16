import { useCallback } from 'react';
import { map } from '../../convex/schema';
import { Graphics as PixiGraphics } from 'pixi.js';
import { Graphics } from '@pixi/react';

export default function DestinationMarker(props: { destination: { x: number; y: number } }) {
  const tileDim = map.tileDim;
  const draw = useCallback(
    (g: PixiGraphics) => {
      const { x, y } = props.destination;
      g.clear();
      g.beginFill({ h: 0, s: 50, l: 90 }, 0.9);
      g.drawCircle(x * tileDim + 0.5 * tileDim, y * tileDim + 0.5 * tileDim, 2);
      g.endFill();
    },
    [props.destination],
  );
  return <Graphics draw={draw} />;
}
