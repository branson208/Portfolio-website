import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getAboutConfig, getSiteConfig } from "../lib/content";

const AboutContext = createContext({ open: false, openAbout: () => {}, closeAbout: () => {} });

export const useAbout = () => useContext(AboutContext);

export function AboutProvider({ children }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({ open, openAbout: () => setOpen(true), closeAbout: () => setOpen(false) }),
    [open]
  );

  return (
    <AboutContext.Provider value={value}>
      {children}
      <AboutOverlay open={open} onClose={() => setOpen(false)} />
    </AboutContext.Provider>
  );
}

function AboutOverlay({ open, onClose }) {
  const about = getAboutConfig();
  const site = getSiteConfig();
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const paragraphs = about.paragraphs ?? (site.aboutText ? [site.aboutText] : []);
  const images = about.images ?? [];
  const imageIntervalMs = Number.isFinite(about.imageIntervalMs)
    ? Math.max(600, about.imageIntervalMs)
    : 3200;
  const email = about.email || site.contactEmail;
  const phone = about.phone;
  const name = about.name;
  const skills = about.skills ?? [];
  const software = about.software ?? [];

  useEffect(() => {
    if (!open || images.length <= 1) return undefined;
    setHeroIndex(0);
    const timer = setInterval(() => {
      setHeroIndex((i) => (i + 1) % images.length);
    }, imageIntervalMs);
    return () => clearInterval(timer);
  }, [open, images.length, imageIntervalMs]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="about-overlay"
          initial={{ y: "-100%" }}
          animate={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ duration: 0.6, ease: [0.76, 0, 0.24, 1] }}
        >
          <nav className="index-nav about-nav">
            <span className="brand">{site.brand || "Portfolio"}</span>
            <button className="nav-info about-close" onClick={onClose}>( Close )</button>
          </nav>

          <div className="about-scroll">
            <div className="about-inner">
              {images.length > 0 && (
                <div className="about-hero">
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={images[heroIndex].src}
                      src={images[heroIndex].src}
                      alt={images[heroIndex].alt || ""}
                      initial={{ opacity: 0, scale: 1.04 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1 }}
                      transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
                    />
                  </AnimatePresence>
                </div>
              )}

              <div className="about-text">
                <div className="about-intro">
                  {about.heading && <p className="about-eyebrow">{about.heading}</p>}
                  {name && <h2 className="about-name">{name}</h2>}
                  {paragraphs.map((p, i) => (
                    <p key={i} className="about-para">{p}</p>
                  ))}
                </div>

                <div className="about-meta">
                  {about.location && (
                    <div className="about-meta-row">
                      <span>Based</span>
                      <span>{about.location}</span>
                    </div>
                  )}
                  {phone && (
                    <div className="about-meta-row">
                      <span>Phone</span>
                      <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a>
                    </div>
                  )}
                  {email && (
                    <div className="about-meta-row">
                      <span>Contact</span>
                      <a href={`mailto:${email}`}>{email}</a>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {(skills.length > 0 || software.length > 0) && (
              <div className="about-skills">
                {skills.length > 0 && (
                  <div className="about-skills-col">
                    <p className="about-eyebrow">Skills</p>
                    <ul className="skill-list">
                      {skills.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {software.length > 0 && (
                  <div className="about-skills-col">
                    <p className="about-eyebrow">Software / Tools</p>
                    <div className="software-grid">
                      {software.map((tool, i) => (
                        <SoftwareLogo key={i} tool={tool} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SoftwareLogo({ tool }) {
  const [failed, setFailed] = useState(false);
  const logoSrc = tool.src || (tool.slug ? `https://cdn.simpleicons.org/${tool.slug}/111111` : null);
  const showImg = logoSrc && !failed;
  return (
    <div className="software-chip" title={tool.name}>
      {showImg ? (
        <>
          <img
            className="software-logo"
            src={logoSrc}
            alt={tool.name}
            loading="lazy"
            onError={() => setFailed(true)}
          />
          <span className="software-name">{tool.name}</span>
        </>
      ) : (
        <span className="software-badge">{tool.name}</span>
      )}
    </div>
  );
}
