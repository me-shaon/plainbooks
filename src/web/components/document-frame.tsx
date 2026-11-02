import { type CSSProperties, useEffect, useRef, useState } from "react";
import { cn } from "./ui/utils";

/**
 * The width the document renders at: the 842 px page plus the page shell's side padding.
 * The document CSS switches to its phone layout below 768 px, so a narrower frame would
 * not look like the PDF.
 */
export const DOCUMENT_FRAME_WIDTH = 890;

/** The width of an element, kept up to date. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

interface DocumentFrameProps {
  title: string;
  className?: string;
}

/**
 * A rendered document at page width, scaled down to fit its box, so the preview looks like
 * the PDF at every window size. The HTML is sandboxed and runs no scripts. The frame has a
 * fixed height and scrolls inside, because a sandboxed frame cannot report its height.
 */
export function ScaledDocumentFrame({
  title,
  html,
  className,
}: DocumentFrameProps & { html: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [boxHeight, setBoxHeight] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBoxHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  const scale = width ? Math.min(1, width / DOCUMENT_FRAME_WIDTH) : 1;
  const style: CSSProperties = {
    width: DOCUMENT_FRAME_WIDTH,
    height: boxHeight ? boxHeight / scale : "100%",
    transform: `scale(${scale})`,
  };
  return (
    <div ref={ref} className={cn("relative overflow-hidden", className)}>
      <iframe
        title={title}
        sandbox=""
        srcDoc={html}
        style={style}
        className="absolute top-0 left-0 origin-top-left border-0"
      />
    </div>
  );
}

/**
 * A same-origin document page at page width, scaled to fit. The frame grows to the height
 * of the page inside it, so the app page scrolls once and the preview adds no scroll bar.
 */
export function AutoHeightDocumentFrame({
  title,
  src,
  className,
}: DocumentFrameProps & { src: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | undefined;
    // The body, not the root element: the root is never shorter than the frame itself,
    // so it could not shrink the frame to the document.
    const fit = () => {
      const body = element.contentDocument?.body;
      if (!body) return;
      const measure = () => setHeight(Math.ceil(body.getBoundingClientRect().height));
      measure();
      observer?.disconnect();
      observer = new ResizeObserver(measure);
      observer.observe(body);
    };
    element.addEventListener("load", fit);
    return () => {
      element.removeEventListener("load", fit);
      observer?.disconnect();
    };
  }, []);

  const scale = width ? Math.min(1, width / DOCUMENT_FRAME_WIDTH) : 1;
  const frameHeight = height ?? 800;
  return (
    <div ref={ref} className={cn("relative overflow-hidden", className)}>
      <div style={{ height: frameHeight * scale }}>
        <iframe
          ref={frame}
          title={title}
          src={src}
          scrolling="no"
          style={{
            width: DOCUMENT_FRAME_WIDTH,
            height: frameHeight,
            transform: `scale(${scale})`,
          }}
          className="block origin-top-left border-0"
        />
      </div>
    </div>
  );
}
