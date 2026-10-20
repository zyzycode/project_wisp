import { ObservationSettings } from './Interaction/ObservationSettings';
import React, { useState } from 'react';
import type { RenderPresentationState } from '../render-engine';
import { PET_PRESENTATION_LAYOUT, calculateWindowRootPivotOffset } from '../../shared/pet-presentation-layout';
import { CharacterRenderer } from './Character/CharacterRenderer';
import { MemoryCards } from './Chat/MemoryCards';
import { ChatInput } from './Chat/ChatInput';
import { SpeechBubble } from './Chat/SpeechBubble';
import { DebugHUD } from './Debug';
import { ContextMenu } from './Interaction/ContextMenu';
import { AnimationPreviewControls } from './Interaction/AnimationPreviewControls';
import type { useDesktopPetController } from '../hooks/useDesktopPetController';

export interface PetOverlayProps {
  readonly model: ReturnType<typeof useDesktopPetController>;
}

/** Pure React surface for the state and callbacks composed by DesktopPet. */
export const PetOverlay: React.FC<PetOverlayProps> = ({ model }) => {
  const [presentation, setPresentation] = useState<RenderPresentationState>();
  const [assetLoadError, setAssetLoadError] = useState<string>();
  const labelAnchor = calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT);
  const debugHud = (
    <DebugHUD
      runtimeDiagnostics={{ brain: model.bodySnapshot?.brain, presentation, assetLoadError }}
      needs={model.debugTelemetry.character.needs}
      relationship={model.debugTelemetry.character.relationship}
      tone={model.debugTelemetry.character.synthesizedTone}
      animationState={model.animState}
      animationIntent={model.characterAnimationIntent}
      fps={model.renderFps}
      logs={model.debugTelemetry.logs}
      position={model.position}
      isWandering={model.isWandering}
      flipX={model.flipX}
      bodyAnimationKeys={model.manifestAnimations.bodyKeys}
      faceAnimationKeys={model.manifestAnimations.faceKeys}
      selectedBodyAnimationKey={model.inspectorBodyKey}
      selectedFaceAnimationKey={model.inspectorFaceKey}
      showAnchorPoint={model.showAnchorPoint}
      onClearLogs={model.clearDebugLogs}
      onSelectBodyAnimation={(key) => {
        model.setInspectorBodyKey(key);
        if (key === null) model.setInspectorFaceKey(null);
      }}
      onSelectManifestFace={model.setInspectorFaceKey}
      onToggleAnchorPoint={() => model.setShowAnchorPoint((visible) => !visible)}
    />
  );

  return (
    <div
      className={`pet-container ${model.isDragging ? 'is-dragging' : ''} ${model.isWandering ? 'is-wandering' : ''} ${model.menuOpen ? 'menu-is-open' : ''}`}
      style={{ paddingLeft: PET_PRESENTATION_LAYOUT.characterRect.x,
        paddingTop: PET_PRESENTATION_LAYOUT.characterRect.y,
        '--character-top': `${PET_PRESENTATION_LAYOUT.characterRect.y}px`,
      } as React.CSSProperties}
    >
      <div className={`chat-overlay ${model.dialogue.chatOpen ? 'has-input' : ''}`}>
        <SpeechBubble message={model.dialogue.currentMessage} onDismiss={model.dialogue.dismissMessage} />
        {model.dialogue.chatOpen && <MemoryCards {...model.dialogue.memoryCards} />}
        <ChatInput
          canSubmit={model.dialogue.canSubmit}
          errorMessage={model.dialogue.error}
          submissionMessage={model.dialogue.submissionMessage}
          isOpen={model.dialogue.chatOpen}
          onSendMessage={model.dialogue.handleSendMessage}
          onClose={model.dialogue.closeChat}
        />
      </div>
      <ContextMenu
        isOpen={model.menuOpen}
        tone={model.debugTelemetry.character.synthesizedTone}
        currentTheme={model.currentTheme}
        autoWanderEnabled={model.autoWanderEnabled}
        quietMode={model.quietMode}
        onToggleQuietMode={model.toggleQuietMode}
        isSleeping={model.isSleeping}
        debugHudEnabled={model.debugHudEnabled}
        debugHudVisible={model.debugHudVisible}
        isAlwaysOnTop={model.isAlwaysOnTop}
        debugContent={debugHud}
        observationContent={<ObservationSettings bridge={window.wispAPI?.observationCommand} streamId={model.bodySnapshot?.brain.streamId} open={model.menuOpen} />}
        previewContent={<AnimationPreviewControls
          bodyKeys={model.manifestAnimations.bodyKeys}
          faceKeys={model.manifestAnimations.faceKeys}
          bodyKey={model.inspectorBodyKey}
          faceKey={model.inspectorFaceKey}
          loop={model.previewLoop}
          onSelectBody={model.setInspectorBodyKey}
          onSelectFace={model.setInspectorFaceKey}
          onToggleLoop={model.togglePreviewLoop}
          onReplay={model.replayPreview}
        />}
        onClose={() => model.setMenuOpen(false)}
        onPet={model.petFromMenu}
        onPlay={model.playFromMenu}
        onFeed={model.feedFromMenu}
        onThink={model.showRandomThought}
        onToggleSleep={model.toggleSleep}
        onToggleWander={model.toggleWander}
        onToggleDebugHud={() => model.setDebugHudVisible((visible) => !visible)}
        onToggleAlwaysOnTop={model.toggleAlwaysOnTop}
        onResetPosition={model.handleResetPosition}
        onSelectTheme={model.setCurrentTheme}
        onQuit={model.closeApp}
      />
      <CharacterRenderer
        expression={model.expression}
        theme={model.currentTheme}
        visualState={model.visualState}
        isDragging={model.isDragging}
        debugAnimationSelection={model.debugAnimationSelection}
        showAnchorPoint={model.showAnchorPoint}
        onManifestAnimationsLoaded={model.setManifestAnimations}
        onPresentationChanged={model.debugHudEnabled && (model.debugHudVisible || model.menuOpen) ? setPresentation : undefined}
        onAssetLoadError={model.debugHudEnabled ? setAssetLoadError : undefined}
        onAnimationCompleted={model.handleAnimationCompleted}
        onAnimationRejected={model.handleAnimationRejected}
        onGazeDirectionChanged={model.handleGazeDirectionChanged}
        gazeEnabled={model.gazeEnabled}
        globalCursor={model.bodySnapshot?.globalCursor}
        cursorObservationEnabled={model.cursorObservationEnabled}
        onCursorObserved={model.handleCursorObserved}
        onPointerDown={model.drag.onPointerDown}
        onClick={model.handlePetClick}
        onDoubleClick={model.handlePetDoubleClick}
        onContextMenu={model.handleContextMenu}
      />
      {model.debugHudEnabled && model.debugHudVisible && !model.menuOpen ? debugHud : null}
      <div className="pet-label" data-wisp-interactive="true" onClick={model.toggleChat}
        style={{ left: labelAnchor.x, top: labelAnchor.y + 2 }}>
        💬 Wisp • {model.isWandering ? 'wandering' : model.animState}{' '}
        {model.debugTelemetry.character.synthesizedTone === 'affectionate' ? '💖' : ''}
      </div>
    </div>
  );
};
