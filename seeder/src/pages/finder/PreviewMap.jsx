import { useEffect, useMemo, useRef } from 'react';
import MapCanvas from '../../shared/MapCanvas';
import { previewTarget } from './hitModel';

/*
 * An open result row's interactive map, in the thumbnail's place and the
 * same size (--preview-h). It starts on previewTarget (hitModel.js) - the row's nearest
 * structure, marked with its name, else the spawn or the origin - without a glide, so
 * its first frame is the thumbnail it replaces. The map is the page's only one, so it publishes
 * window.__seederDrawer for the e2e tests (one row is open at a time). Props: view
 * (a HitView), yHeight (defaults to the view's). Coordinate labels are off: they
 * collide with the highlight's name, and the card prints the coordinates.
 */
export default function PreviewMap({ view, yHeight }) {
    const apiRef = useRef(null);
    const types = useMemo(() => [...new Set((view?.structures ?? []).map((s) => s.type))], [view]);

    // MapCanvas' own effects run first (a child's before its parent's): by now the
    // world is set and cleared, so the pan and the highlight belong to it.
    useEffect(() => {
        const api = apiRef.current;
        if (!view || !api) return;
        const target = previewTarget(view);
        api.panTo(target.x, target.z, { animate: false });
        api.setHighlight(target);
    }, [view]);

    return (
        <div className="preview-map">
            <MapCanvas
                exposeGlobal
                apiRef={apiRef}
                mcVersion={view.mcVersion}
                seed={view.seed}
                dimension={view.dimension}
                yHeight={yHeight ?? view.yHeight}
                structuresToShow={types}
                showStructureCoords={false}
            />
        </div>
    );
}
