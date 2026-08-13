import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { getOrderedSections, getSectionBySlug, getSiteConfig } from "../lib/content";

const PARALLAX_PX = 60;
const HERO_TRANSITION_RANGE = [0, 0.55];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

// Hide a broken image and its frame so a missing source appears absent instead of erroring.
function hideBrokenMedia(e) {
  const el = e.currentTarget;
  el.style.display = "none";
  const frame = el.closest(".dframe, .dhero-frame");
  if (frame) frame.style.visibility = "hidden";
}

function renderTextBlocks(text) {
  const paragraphs = Array.isArray(text)
    ? text
    : typeof text === "string"
      ? text.split(/\n\s*\n/)
      : [];

  return paragraphs
    .filter((paragraph) => typeof paragraph === "string" && paragraph.trim().length > 0)
    .map((paragraph, index) => (
      <p key={`${paragraph.slice(0, 24)}-${index}`} className="ddesc">{paragraph.trim()}</p>
    ));
}

function ParallaxFrame({ item, containerRef }) {
  const ref = useRef(null);
  const [y, setY] = useState(0);

  useEffect(() => {
    const scroller = containerRef.current;
    const frame = ref.current;
    if (!scroller || !frame) return;

    const update = () => {
      const sRect = scroller.getBoundingClientRect();
      const fRect = frame.getBoundingClientRect();
      const scrollerCenter = sRect.top + scroller.clientHeight * 0.5;
      const frameCenter = fRect.top + fRect.height * 0.5;
      const span = scroller.clientHeight * 0.5 + fRect.height * 0.5;
      const ratio = span > 0 ? clamp((frameCenter - scrollerCenter) / span, -1, 1) : 0;
      setY(-ratio * PARALLAX_PX);
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        update();
      });
    };

    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [containerRef]);

  return (
    <div ref={ref} className="dframe">
      <motion.div className="dframe-inner" style={{ y }}>
        {item.type === "video" ? (
          <video src={item.src} muted autoPlay loop playsInline />
        ) : (
          <img src={item.src} alt={item.alt || ""} onError={hideBrokenMedia} />
        )}
      </motion.div>
    </div>
  );
}

export default function SectionPage() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const scrollRef = useRef(null);

  const section = getSectionBySlug(slug);
  const site = getSiteConfig();

  if (!section) return <Navigate to="/" replace />;

  const allSections = getOrderedSections(location.search);
  const sectionIndex = allSections.findIndex((s) => s.id === section.id);
  const heroOnLeft = sectionIndex === -1 || sectionIndex % 2 === 0;

  const groups = useMemo(
    () => (section.detailGroups ?? []).filter((group) => (group.media ?? []).length > 0),
    [section.detailGroups]
  );

  const mediaCount = useMemo(
    () => groups.reduce((sum, group) => sum + (group.media?.length ?? 0), 0),
    [groups]
  );

  const heroItem = groups[0]?.media?.[0] ?? null;
  const heroStageRef = useRef(null);
  const closeLockRef = useRef(false);
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [heroProgress, setHeroProgress] = useState(0);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const groupRefs = useRef([]);

  useEffect(() => {
    const updateViewport = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const squareSize = Math.max(1, Math.min(viewport.w * 0.44, viewport.h * 0.72));
  const sideWidth = Math.max(1, viewport.w * 0.5);
  const sideHeight = Math.max(1, viewport.h);
  const startScaleX = sideWidth / squareSize;
  const startScaleY = sideHeight / squareSize;

  useEffect(() => {
    const scroller = scrollRef.current;
    const hero = heroStageRef.current;
    if (!scroller || !hero) return;

    const update = () => {
      const range = Math.max(1, hero.offsetHeight - scroller.clientHeight);
      setHeroProgress(clamp(scroller.scrollTop / range, 0, 1));
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        update();
      });
    };

    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const transitionT = clamp(heroProgress / (HERO_TRANSITION_RANGE[1] || 1), 0, 1);
  const frameScaleX = lerp(startScaleX, 1, transitionT);
  const frameScaleY = lerp(startScaleY, 1, transitionT);
  const frameRadius = lerp(0, 2, transitionT);
  const heroImageY = lerp(20, -40, clamp(heroProgress, 0, 1));
  const introOpacity = heroProgress < 0.25
    ? lerp(1, 0.65, clamp(heroProgress / 0.25, 0, 1))
    : lerp(0.65, 0, clamp((heroProgress - 0.25) / 0.25, 0, 1));
  const introY = lerp(0, -28, clamp(heroProgress / 0.5, 0, 1));
  const groupPanelOpacity = clamp((heroProgress - 0.28) / 0.27, 0, 1);

  const closeToIndex = useCallback(() => {
    if (closeLockRef.current) return;
    closeLockRef.current = true;

    const finish = () => {
      navigate(`/${location.search}`);
    };

    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollTop <= 2) {
      finish();
      return;
    }

    scroller.scrollTo({ top: 0, behavior: "smooth" });
    const start = performance.now();
    const waitForTop = () => {
      if (!scrollRef.current || scrollRef.current.scrollTop <= 2 || performance.now() - start > 900) {
        finish();
        return;
      }
      requestAnimationFrame(waitForTop);
    };
    requestAnimationFrame(waitForTop);
  }, [location.search, navigate]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") closeToIndex();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeToIndex]);

  useEffect(() => {
    if (!groups.length) return;
    const scroller = scrollRef.current;
    if (!scroller) return;

    const updateActive = () => {
      const trigger = scroller.scrollTop + scroller.clientHeight * 0.42;
      let next = 0;
      groupRefs.current.forEach((el, idx) => {
        if (!el) return;
        if (trigger >= el.offsetTop) {
          next = idx;
        }
      });

      setActiveGroupIndex((prev) => (prev === next ? prev : next));
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        updateActive();
      });
    };

    updateActive();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [groups]);

  return (
    <div ref={scrollRef} className="detail-page">
      <nav className="index-nav">
        <Link className="brand" to={`/${location.search}`}>{site.brand || "Portfolio"}</Link>
        <button className="nav-info nav-close" onClick={closeToIndex}>( Close )</button>
      </nav>

      {!heroItem && (
        <div className="drow-empty">
          <p>No media found — add images to portfolio.content.json</p>
        </div>
      )}

      {heroItem && (
        <>
          <section
            ref={heroStageRef}
            className={`detail-hero${heroOnLeft ? "" : " detail-hero--flip"}`}
          >
            <div className="dhero-media-side" onClick={closeToIndex}>
              <div className="dhero-media-sticky">
                <motion.div
                  className="dhero-frame"
                  style={{ scaleX: frameScaleX, scaleY: frameScaleY, borderRadius: frameRadius }}
                >
                  <motion.div className="dhero-inner" style={{ y: heroImageY }}>
                    {heroItem.type === "video" ? (
                      <video src={heroItem.src} muted autoPlay loop playsInline />
                    ) : (
                      <img src={heroItem.src} alt={heroItem.alt || ""} onError={hideBrokenMedia} />
                    )}
                  </motion.div>
                </motion.div>
              </div>
            </div>

            <div className="dhero-info-side">
              <div className="dhero-info-sticky">
                <motion.div className="dhero-intro" style={{ opacity: introOpacity, y: introY }}>
                  {section.summary && renderTextBlocks(section.summary)}
                </motion.div>

                <motion.div className="dhero-group-panel" style={{ opacity: groupPanelOpacity }}>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={`group-${activeGroupIndex}`}
                      className="dgroup-copy"
                      initial={{ opacity: 0, y: 18 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -12 }}
                      transition={{ duration: 0.34, ease: [0.76, 0, 0.24, 1] }}
                    >
                      {groups[activeGroupIndex]?.title && (
                        <p className="dgroup-label">{groups[activeGroupIndex].title}</p>
                      )}
                      {groups[activeGroupIndex]?.description && renderTextBlocks(groups[activeGroupIndex].description)}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>

                <div className="dhero-footer">
                  {sectionIndex >= 0 && (
                    <span className="dpage-num">{String(sectionIndex + 1).padStart(2, "0")}</span>
                  )}
                  <h1 className="dpage-title">{section.title}</h1>
                  <span className="ditem-num">
                    Group {String(activeGroupIndex + 1).padStart(2, "0")} / {String(groups.length).padStart(2, "0")}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className={`detail-stream${heroOnLeft ? "" : " detail-stream--flip"}`}>
            <aside className="dstream-copy">
              <div className="dstream-copy-sticky">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={`stream-group-${activeGroupIndex}`}
                    className="dgroup-copy"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3, ease: [0.76, 0, 0.24, 1] }}
                  >
                    {groups[activeGroupIndex]?.title && (
                      <p className="dgroup-label">{groups[activeGroupIndex].title}</p>
                    )}
                    {groups[activeGroupIndex]?.description && renderTextBlocks(groups[activeGroupIndex].description)}
                  </motion.div>
                </AnimatePresence>

                <div className="dhero-footer">
                  {sectionIndex >= 0 && (
                    <span className="dpage-num">{String(sectionIndex + 1).padStart(2, "0")}</span>
                  )}
                  <h2 className="dpage-title">{section.title}</h2>
                  <span className="ditem-num">
                    {String(mediaCount).padStart(2, "0")} total media
                  </span>
                </div>
              </div>
            </aside>

            <div className="dstream-media">
              {groups.map((group, groupIdx) => (
                <section
                  key={group.id || `${group.title}-${groupIdx}`}
                  className="dgroup-block"
                  ref={(el) => {
                    groupRefs.current[groupIdx] = el;
                  }}
                >
                  {(group.media ?? []).map((item, mediaIdx) => (
                    <motion.div
                      key={`${groupIdx}-${item.src}-${mediaIdx}`}
                      className="dmedia-row"
                      initial={{ opacity: 0, y: 40 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ root: scrollRef, once: true, amount: 0.18 }}
                      transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
                    >
                      <ParallaxFrame item={item} containerRef={scrollRef} />
                    </motion.div>
                  ))}
                </section>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}